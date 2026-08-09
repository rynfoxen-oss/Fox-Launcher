using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;

namespace Launcher.Utils;

/// <summary>
/// Windows DPAPI wrapper used to encrypt sensitive tokens at rest. Falls back
/// to a portable-mode key derivation (machine-bound, NOT user-bound) when
/// DPAPI is unavailable. Tokens are never stored as plain UTF-8 base64 —
/// see the portable-mode warning in <see cref="Encrypt"/>.
/// </summary>
public static class SecureStore
{
    private static readonly bool Supported = RuntimeInformation.IsOSPlatform(OSPlatform.Windows);
    private static int _portableWarned;

    /// <summary>Encrypts a string using the current user's DPAPI key.</summary>
    public static string Encrypt(string plainText)
    {
        if (string.IsNullOrEmpty(plainText)) return "";
        var bytes = Encoding.UTF8.GetBytes(plainText);
        if (!Supported) return PortableEncrypt(bytes);
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
        if (!Supported) return PortableDecrypt(bytes);
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

    /// <summary>
    /// Portable-mode encryption. Tokens must NOT be stored as plain base64 on a
    /// USB stick — anyone with the file could read them. We derive a key from
    /// machine-specific data (machine name + processor count + a fixed app
    /// salt) and use AES-GCM. This is NOT user-bound and NOT as strong as DPAPI;
    /// it's only meant to defeat casual `cat`/`type` on the settings file. The
    /// one-time warning printed the first time it runs recommends using offline
    /// accounts only on portable installs.
    /// </summary>
    private static string PortableEncrypt(byte[] bytes)
    {
        WarnPortableOnce();
        var key = DerivePortableKey();
        var nonce = new byte[AesGcm.NonceByteSizes.MaxSize];
        System.Security.Cryptography.RandomNumberGenerator.Fill(nonce);
        var ciphertext = new byte[bytes.Length];
        var tag = new byte[AesGcm.TagByteSizes.MaxSize];
        using (var aes = new AesGcm(key, tag.Length))
        {
            aes.Encrypt(nonce, bytes, ciphertext, tag);
        }
        // Layout: [1 byte version=1][16 byte nonce][N bytes ciphertext][16 byte tag]
        var blob = new byte[1 + nonce.Length + ciphertext.Length + tag.Length];
        blob[0] = 1;
        Buffer.BlockCopy(nonce, 0, blob, 1, nonce.Length);
        Buffer.BlockCopy(ciphertext, 0, blob, 1 + nonce.Length, ciphertext.Length);
        Buffer.BlockCopy(tag, 0, blob, 1 + nonce.Length + ciphertext.Length, tag.Length);
        CryptographicOperations.ZeroMemory(key);
        return Convert.ToBase64String(blob);
    }

    private static string PortableDecrypt(byte[] blob)
    {
        if (blob.Length == 0 || blob[0] != 1)
            throw new InvalidOperationException("Unrecognized portable SecureStore payload.");
        var nonce = new byte[AesGcm.NonceByteSizes.MaxSize];
        var tagLen = AesGcm.TagByteSizes.MaxSize;
        var cipherLen = blob.Length - 1 - nonce.Length - tagLen;
        if (cipherLen <= 0 || nonce.Length + tagLen + 1 > blob.Length)
            throw new InvalidOperationException("Corrupt portable SecureStore payload.");
        Buffer.BlockCopy(blob, 1, nonce, 0, nonce.Length);
        var ciphertext = new byte[cipherLen];
        Buffer.BlockCopy(blob, 1 + nonce.Length, ciphertext, 0, cipherLen);
        var tag = new byte[tagLen];
        Buffer.BlockCopy(blob, 1 + nonce.Length + cipherLen, tag, 0, tagLen);
        var plaintext = new byte[cipherLen];
        var key = DerivePortableKey();
        try
        {
            using var aes = new AesGcm(key, tag.Length);
            aes.Decrypt(nonce, ciphertext, tag, plaintext);
            return Encoding.UTF8.GetString(plaintext);
        }
        catch (CryptographicException)
        {
            throw new InvalidOperationException(
                "Could not decrypt stored token. The launcher data was likely created on a different machine; use an offline account or sign in again.");
        }
        finally
        {
            CryptographicOperations.ZeroMemory(key);
        }
    }

    private static byte[] DerivePortableKey()
    {
        const string salt = "FoxLauncher.Portable.v1";
        var identity = $"{Environment.MachineName}|{Environment.ProcessorCount}|{Environment.OSVersion.VersionString}";
        var material = Encoding.UTF8.GetBytes(salt + ":" + identity);
        return SHA256.HashData(material);
    }

    private static void WarnPortableOnce()
    {
        if (System.Threading.Interlocked.Exchange(ref _portableWarned, 1) != 0) return;
        try
        {
            var path = Path.Combine(Paths.Root, "launcher.log");
            Directory.CreateDirectory(Paths.Root);
            File.AppendAllText(path,
                $"[{DateTimeOffset.UtcNow:O}] [WARN] SecureStore is running in portable mode. " +
                "Tokens are encrypted with a machine-derived key, but anyone with the launcher " +
                "folder on the same machine can still read them. Prefer offline accounts on portable installs.\n");
        }
        catch { /* best-effort */ }
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
