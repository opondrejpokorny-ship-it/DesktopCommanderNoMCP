// EXPERIMENT ONLY: NOT a production security boundary or stock-policy replacement.
// This proof checks the final path and link count of ONE ALREADY-OPEN FILE HANDLE,
// before reading any bytes through that same handle. Windows only.
using System;
using System.IO;
using System.Security.Cryptography;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32.SafeHandles;

public static class Win32HandleAuthorityV2
{
    [StructLayout(LayoutKind.Sequential)]
    private struct NativeFileTime { public uint Low; public uint High; }

    [StructLayout(LayoutKind.Sequential)]
    private struct FileInfoByHandle
    {
        public uint Attributes;
        public NativeFileTime Created;
        public NativeFileTime Accessed;
        public NativeFileTime Written;
        public uint VolumeSerial;
        public uint SizeHigh;
        public uint SizeLow;
        public uint NumberOfLinks;
        public uint FileIndexHigh;
        public uint FileIndexLow;
    }

    [DllImport("kernel32.dll", EntryPoint = "CreateFileW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern SafeFileHandle OpenFile(
        string name, uint desiredAccess, uint shareMode, IntPtr security,
        uint creation, uint flags, IntPtr templateFile);

    [DllImport("kernel32.dll", EntryPoint = "GetFinalPathNameByHandleW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern uint FinalPath(
        SafeFileHandle handle, StringBuilder buffer, uint bufferLength, uint flags);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetFileInformationByHandle(
        SafeFileHandle handle, out FileInfoByHandle information);

    // The caller MUST have separately established that allowedRoot is its
    // trusted stock-authorized directory. This probe does NOT do so.
    public static string Observe(string allowedRoot, string requestedFile)
    {
        try
        {
            if (String.IsNullOrWhiteSpace(allowedRoot) || String.IsNullOrWhiteSpace(requestedFile))
                return "DENY_INPUT";

            // Opening a handle can itself expose metadata. No file-content bytes
            // may be read until authorization against that same handle succeeds.
            using (SafeFileHandle handle = OpenFile(
                requestedFile, 0x80000000, 0x00000007, IntPtr.Zero, 3, 0x00000080, IntPtr.Zero))
            {
                if (handle == null || handle.IsInvalid) return "DENY_OPEN";
                StringBuilder buffer = new StringBuilder(32768);
                uint length = FinalPath(handle, buffer, (uint)buffer.Capacity, 0);
                if (length == 0 || length >= buffer.Capacity) return "DENY_FINAL_PATH";
                string final = buffer.ToString();
                if (!final.StartsWith(@"\\?\", StringComparison.Ordinal)) return "DENY_DEVICE_PATH";
                final = final.Substring(4);
                if (final.StartsWith("UNC\\", StringComparison.OrdinalIgnoreCase) ||
                    final.StartsWith("Volume{", StringComparison.OrdinalIgnoreCase))
                    return "DENY_DEVICE_PATH";

                string root = Path.GetFullPath(allowedRoot).TrimEnd('\\');
                string actual = Path.GetFullPath(final);
                string prefix = root + "\\";
                if (!actual.Equals(root, StringComparison.OrdinalIgnoreCase) &&
                    !actual.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
                    return "DENY_OUTSIDE";

                FileInfoByHandle info;
                if (!GetFileInformationByHandle(handle, out info)) return "DENY_IDENTITY";
                // Deliberately refuse even benign hardlinks: path-based provenance
                // cannot distinguish which alias originally carried the bytes.
                if (info.NumberOfLinks != 1) return "DENY_HARDLINK";
                if (info.SizeHigh != 0 || info.SizeLow > 65536) return "DENY_SIZE";

                // IMPORTANT: do not reopen by pathname; read through the
                // previously validated OS handle only.
                using (FileStream stream = new FileStream(handle, FileAccess.Read))
                using (SHA256 sha = SHA256.Create())
                    return "ALLOW:" + BitConverter.ToString(sha.ComputeHash(stream))
                        .Replace("-", "").ToLowerInvariant();
            }
        }
        catch
        {
            return "DENY_ERROR";
        }
    }

    // EXPERIMENTAL ONLY. Must be captured and held by a trusted authority,
    // not supplied or replaceable by an untrusted caller/model.
    public static string CaptureRootIdentity(string allowedRoot)
    {
        try
        {
            if (String.IsNullOrWhiteSpace(allowedRoot)) return "DENY_INPUT";
            string root = Path.GetFullPath(allowedRoot).TrimEnd('\\');
            if (root.Length < 3 || root.StartsWith(@"\\\\", StringComparison.Ordinal))
                return "DENY_ROOT_PATH";

            // FILE_READ_ATTRIBUTES + FILE_FLAG_BACKUP_SEMANTICS to open a directory.
            using (SafeFileHandle rootHandle = OpenFile(
                root, 0x00000080, 0x00000007, IntPtr.Zero, 3, 0x02000000, IntPtr.Zero))
            {
                if (rootHandle == null || rootHandle.IsInvalid) return "DENY_ROOT_OPEN";
                FileInfoByHandle info;
                if (!GetFileInformationByHandle(rootHandle, out info))
                    return "DENY_ROOT_IDENTITY";
                if ((info.Attributes & 0x00000010) == 0 ||
                    (info.Attributes & 0x00000400) != 0)
                    return "DENY_ROOT_ATTRIBUTES";

                StringBuilder buffer = new StringBuilder(32768);
                uint length = FinalPath(rootHandle, buffer, (uint)buffer.Capacity, 0);
                if (length == 0 || length >= buffer.Capacity)
                    return "DENY_ROOT_PATH";
                string final = buffer.ToString();
                if (!final.StartsWith(@"\\?\", StringComparison.Ordinal))
                    return "DENY_ROOT_PATH";
                final = final.Substring(4);
                if (final.StartsWith("UNC\\", StringComparison.OrdinalIgnoreCase) ||
                    final.StartsWith("Volume{", StringComparison.OrdinalIgnoreCase))
                    return "DENY_ROOT_PATH";
                string actual = Path.GetFullPath(final).TrimEnd('\\');
                if (!actual.Equals(root, StringComparison.OrdinalIgnoreCase))
                    return "DENY_ROOT_PATH";

                string canonicalPath = root.ToUpperInvariant();
                using (SHA256 sha = SHA256.Create())
                {
                    byte[] hash = sha.ComputeHash(Encoding.UTF8.GetBytes(canonicalPath));
                    string pathDigest = BitConverter.ToString(hash)
                        .Replace("-", "").ToLowerInvariant();
                    return String.Format(
                        "ROOT:{0:X8}-{1:X8}-{2:X8}-{3}",
                        info.VolumeSerial, info.FileIndexHigh,
                        info.FileIndexLow, pathDigest);
                }
            }
        }
        catch
        {
            return "DENY_ROOT_ERROR";
        }
    }

    // Stable-state negative check only: a root rename/replace between these
    // calls can still enable an unauthorized file OPEN/READ inside Observe().
    // Do not mistake pre/post checks for atomic filesystem confinement.
    public static string ObserveBound(
        string allowedRoot, string requestedFile, string trustedRootId)
    {
        if (String.IsNullOrWhiteSpace(trustedRootId) ||
            !System.Text.RegularExpressions.Regex.IsMatch(
                trustedRootId,
                @"^ROOT:[A-F0-9]{8}-[A-F0-9]{8}-[A-F0-9]{8}-[a-f0-9]{64}$",
                System.Text.RegularExpressions.RegexOptions.CultureInvariant))
            return "DENY_ROOT_IDENTITY";

        string rootPath;
        try { rootPath = Path.GetFullPath(allowedRoot).TrimEnd('\\'); }
        catch { return "DENY_ROOT_PATH"; }
        string expectedDigest;
        using (SHA256 sha = SHA256.Create())
            expectedDigest = BitConverter.ToString(
                sha.ComputeHash(Encoding.UTF8.GetBytes(rootPath.ToUpperInvariant())))
                .Replace("-", "").ToLowerInvariant();

        if (!trustedRootId.EndsWith("-" + expectedDigest, StringComparison.Ordinal))
            return "DENY_ROOT_PATH";

        string current = CaptureRootIdentity(allowedRoot);
        if (!String.Equals(current, trustedRootId, StringComparison.Ordinal))
            return "DENY_ROOT_IDENTITY";

        string observation = Observe(allowedRoot, requestedFile);
        // Useful diagnostic, NOT prevention of an already executed read.
        if (!String.Equals(CaptureRootIdentity(allowedRoot),
            trustedRootId, StringComparison.Ordinal))
            return "DENY_ROOT_IDENTITY";

        return observation;
    }
}
