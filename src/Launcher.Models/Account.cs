using System.Text.Json.Serialization;

namespace Launcher.Models;

/// <summary>
/// A saved launcher account. For <see cref="AccountType.Microsoft"/> accounts the
/// session tokens are stored and refreshed automatically when possible.
/// </summary>
public sealed class Account
{
    /// <summary>Mojang / Xbox profile UUID (no dashes for offline accounts).</summary>
    public string Uuid { get; set; } = "";

    /// <summary>In-game player name.</summary>
    public string Username { get; set; } = "";

    /// <summary>Minecraft access token (empty for offline accounts).</summary>
    public string AccessToken { get; set; } = "";

    /// <summary>OAuth refresh token used to obtain new access tokens.</summary>
    public string RefreshToken { get; set; } = "";

    /// <summary>OAuth access token for the Microsoft identity layer.</summary>
    public string MicrosoftAccessToken { get; set; } = "";

    /// <summary>User hash (UHS) from the Xbox XSTS exchange.</summary>
    public string UserHash { get; set; } = "";

    /// <summary>Xbox user id (used by some servers for identity).</summary>
    public string XboxUserId { get; set; } = "";

    /// <summary>When the access token expires.</summary>
    public DateTimeOffset ExpiresAt { get; set; } = DateTimeOffset.MinValue;

    /// <summary>When the account was created.</summary>
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;

    /// <summary>When the account was last used to launch the game.</summary>
    public DateTimeOffset LastUsedAt { get; set; } = DateTimeOffset.MinValue;

    /// <summary>Kind of account.</summary>
    [JsonConverter(typeof(JsonStringEnumConverter))]
    public AccountType Type { get; set; } = AccountType.Offline;

    /// <summary>Public URL of the player skin used for the avatar (may be empty).</summary>
    public string SkinUrl { get; set; } = "";

    /// <summary>Player model variant declared by the account: "CLASSIC", "SLIM"
    /// or empty when unknown. Used for automatic preview model detection.</summary>
    public string SkinVariant { get; set; } = "";

    /// <summary>History of usernames the account has used (oldest first).</summary>
    public List<string> UsernameHistory { get; set; } = new();

    [JsonIgnore]
    public bool IsExpired =>
        Type == AccountType.Microsoft && ExpiresAt <= DateTimeOffset.UtcNow.AddMinutes(5);

    [JsonIgnore]
    public string DisplayName => string.IsNullOrWhiteSpace(Username) ? "Player" : Username;

    [JsonIgnore]
    public string AvatarUrl =>
        Type == AccountType.Microsoft
            ? $"https://minotar.net/helm/{Username}/64.png"
            : SkinUrl;
}
