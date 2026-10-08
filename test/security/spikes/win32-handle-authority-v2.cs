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
}
