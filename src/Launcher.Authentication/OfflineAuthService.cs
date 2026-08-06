using Launcher.Models;

namespace Launcher.Authentication;

/// <summary>Creates local offline profiles for playing without a Microsoft account.</summary>
public sealed class OfflineAuthService
{
    /// <summary>
    /// Creates an offline account. The UUID is derived deterministically from the
    /// player name so skins/identity stay stable between launches.
    /// </summary>
    public Account CreateOfflineAccount(string playerName)
    {
        var name = string.IsNullOrWhiteSpace(playerName) ? "Player" : playerName.Trim();
        var uuid = DeriveUuid(name);
        return new Account
        {
            Type = AccountType.Offline,
            Username = name,
            Uuid = uuid,
            AccessToken = Guid.NewGuid().ToString("N"),
            CreatedAt = DateTimeOffset.UtcNow,
            UsernameHistory = { name }
        };
    }

    /// <summary>
    /// Derives a stable offline UUID from a name using the classic
    /// "OfflinePlayer:&lt;name&gt;" MD5 scheme.
    /// </summary>
    public static string DeriveUuid(string name)
    {
        using var md5 = System.Security.Cryptography.MD5.Create();
        var input = System.Text.Encoding.UTF8.GetBytes("OfflinePlayer:" + name);
        var hash = md5.ComputeHash(input);

        // Version 3 UUID (name-based) - set version and variant bits.
        hash[6] = (byte)((hash[6] & 0x0F) | 0x30);
        hash[8] = (byte)((hash[8] & 0x3F) | 0x80);

        return Convert.ToHexString(hash).ToLowerInvariant();
    }
}
