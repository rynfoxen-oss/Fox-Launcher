using System.Runtime.InteropServices;
using System.Text;

namespace Launcher.Utils;

/// <summary>
/// Windows DPAPI wrapper used to encrypt sensitive tokens at rest. Falls back
/// to plain base64 when DPAPI is unavailable (e.g. tests on other platforms).
/// </summary>
public static class SecureStore
{
    private static readonly bool Supported = RuntimeInformation.IsOSPlatform(OSPlatform.Windows);

    /// <summary>Encrypts a string using the current user's DPAPI key.</summary>
    public static string Encrypt(string plainText)
    {
        if (string.IsNullOrEmpty(plainText)) return "";
        var bytes = Encoding.UTF8.GetBytes(plainText);
        if (!Supported) return Convert.ToBase64String(bytes);
        var blob = new DataBlob { cbData = bytes.Length, pbData = Marshal.AllocHGlobal(bytes.Length) };
        try
        {
            Marshal.Copy(bytes, 0, blob.pbData, bytes.Length);
            if (!CryptProtectData(ref blob, "FoxLauncher", IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, 1, out var outBlob))
                throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
            try
            {
                var result = new byte[outBlob.cbData];
                Marshal.Copy(outBlob.pbData, result, 0, outBlob.cbData);
                return Convert.ToBase64String(result);
            }
            finally
            {
                LocalFree(outBlob.pbData);
            }
        }
        finally
        {
            Marshal.FreeHGlobal(blob.pbData);
        }
    }

    /// <summary>Decrypts a string previously encrypted with <see cref="Encrypt"/>.</summary>
    public static string Decrypt(string cipherText)
    {
        if (string.IsNullOrEmpty(cipherText)) return "";
        var bytes = Convert.FromBase64String(cipherText);
        if (!Supported) return Encoding.UTF8.GetString(bytes);
        var blob = new DataBlob { cbData = bytes.Length, pbData = Marshal.AllocHGlobal(bytes.Length) };
        try
        {
            Marshal.Copy(bytes, 0, blob.pbData, bytes.Length);
            if (!CryptUnprotectData(ref blob, out _, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, 1, out var outBlob))
                throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
            try
            {
                var result = new byte[outBlob.cbData];
                Marshal.Copy(outBlob.pbData, result, 0, outBlob.cbData);
                return Encoding.UTF8.GetString(result);
            }
            finally
            {
                LocalFree(outBlob.pbData);
            }
        }
        finally
        {
            Marshal.FreeHGlobal(blob.pbData);
        }
    }

    [DllImport("crypt32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CryptProtectData(
        ref DataBlob pDataIn, string szDataDescr, IntPtr pOptionalEntropy,
        IntPtr pvReserved, IntPtr pPromptStruct, uint dwFlags, out DataBlob pDataOut);

    [DllImport("crypt32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CryptUnprotectData(
        ref DataBlob pDataIn, out string ppszDataDescr, IntPtr pOptionalEntropy,
        IntPtr pvReserved, IntPtr pPromptStruct, uint dwFlags, out DataBlob pDataOut);

    [DllImport("kernel32.dll")]
    private static extern IntPtr LocalFree(IntPtr hMem);

    [StructLayout(LayoutKind.Sequential)]
    private struct DataBlob
    {
        public int cbData;
        public IntPtr pbData;
    }
}
