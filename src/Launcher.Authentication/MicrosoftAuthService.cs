using System.IO;
using System.Text.Json.Serialization;
using Launcher.Network;
using Launcher.Utils;

namespace Launcher.Authentication;

/// <summary>
/// Microsoft OAuth (device code flow) + Xbox Live + Minecraft Services chain.
///
/// Flow: Microsoft account OAuth (device code) -&gt; Xbox Live token -&gt;
/// XSTS token -&gt; Minecraft bearer token -&gt; Minecraft profile.
/// Requires a registered Azure app with the device-code flow enabled
/// (see README "Microsoft client id").
/// </summary>
public sealed class MicrosoftAuthService
{
    private readonly Http _http;

    private const string DeviceCodeUrl = "https://login.microsoftonline.com/consumers/oauth2/v2.0/devicecode";
    private const string TokenUrl = "https://login.microsoftonline.com/consumers/oauth2/v2.0/token";
    private const string XblAuthUrl = "https://user.auth.xboxlive.com/user/authenticate";
    private const string XstsAuthUrl = "https://xsts.auth.xboxlive.com/xsts/authorize";
    private const string MinecraftLoginUrl = "https://api.minecraftservices.com/authentication/login_with_xbox";
    private const string MinecraftProfileUrl = "https://api.minecraftservices.com/minecraft/profile";
    private const string MinecraftSkinsUrl = "https://api.minecraftservices.com/minecraft/profile/skins";
    private const string Scope = "XboxLive.signin offline_access";

    public MicrosoftAuthService(Http http) => _http = http;

    /// <summary>Requests a device code the user must enter at microsoft.com/link.</summary>
    public async Task<DeviceCodeInfo> RequestDeviceCodeAsync(string clientId, CancellationToken ct = default)
    {
        var form = new Dictionary<string, string>
        {
            ["client_id"] = clientId,
            ["scope"] = Scope
        };
        var raw = await _http.PostFormAsync(DeviceCodeUrl, form, ct);
        return Json.DeserializeApi<DeviceCodeInfo>(raw)
               ?? throw new InvalidOperationException("Microsoft did not return a device code.");
    }

    /// <summary>
    /// Polls until the user has authenticated, then exchanges for a Minecraft
    /// session. Returns a fully populated <see cref="Launcher.Models.Account"/>.
    /// </summary>
    public async Task<Launcher.Models.Account> CompleteLoginAsync(
        DeviceCodeInfo deviceCode,
        string clientId,
        Action<DeviceCodePollStatus>? onStatus = null,
        CancellationToken ct = default)
    {
        // Microsoft device codes expire (typically 900s). Track a wall-clock deadline
        // so a stuck/unknown code can't hang the UI forever.
        var pollInterval = TimeSpan.FromSeconds(deviceCode.Interval > 0 ? deviceCode.Interval : 5);
        var expiresAt = DateTimeOffset.UtcNow.AddSeconds(deviceCode.ExpiresIn > 0 ? deviceCode.ExpiresIn : 900);

        while (true)
        {
            ct.ThrowIfCancellationRequested();
            if (DateTimeOffset.UtcNow >= expiresAt)
            {
                throw new TimeoutException(
                    "The login link has expired. Restart the Microsoft login to get a new code.");
            }
            await Task.Delay(pollInterval, ct);

            var form = new Dictionary<string, string>
            {
                ["grant_type"] = "urn:ietf:params:oauth:grant-type:device_code",
                ["client_id"] = clientId,
                ["device_code"] = deviceCode.DeviceCode
            };

            var raw = await _http.PostFormAsync(TokenUrl, form, ct);
            TokenResponse? token;
            try
            {
                token = Json.DeserializeApi<TokenResponse>(raw);
            }
            catch
            {
                token = null;
            }

            if (token is not null && !string.IsNullOrEmpty(token.AccessToken))
            {
                onStatus?.Invoke(new DeviceCodePollStatus { State = PollState.Completed });
                return await ExchangeForMinecraftAccountAsync(token, ct);
            }

            // The token endpoint returns an "error" JSON while still pending.
            var error = Json.DeserializeApi<DeviceCodeError>(raw)?.Error;
            switch (error)
            {
                case "authorization_pending":
                    onStatus?.Invoke(new DeviceCodePollStatus { State = PollState.Pending, Message = "Waiting for authorization..." });
                    continue;
                case "slow_down":
                    onStatus?.Invoke(new DeviceCodePollStatus { State = PollState.Pending, Message = "Slowing down polling..." });
                    await Task.Delay(TimeSpan.FromSeconds(5), ct);
                    continue;
                case "authorization_declined":
                case "access_denied":
                    throw new InvalidOperationException("Authorization was declined.");
                case "expired_token":
                case "bad_verification_code":
                    throw new InvalidOperationException("The login link has expired. Try again.");
                default:
                    onStatus?.Invoke(new DeviceCodePollStatus { State = PollState.Pending, Message = "Waiting for authorization..." });
                    continue;
            }
        }
    }

    private async Task<Launcher.Models.Account> ExchangeForMinecraftAccountAsync(TokenResponse token, CancellationToken ct)
    {
        // 1. Xbox Live authentication
        var xblJson = Json.Serialize(new
        {
            Properties = new
            {
                AuthMethod = "RPS",
                SiteName = "user.auth.xboxlive.com",
                RpsTicket = token.AccessToken
            },
            RelyingParty = "http://auth.xboxlive.com",
            TokenType = "JWT"
        });
        var xblRaw = await _http.PostJsonAsync(XblAuthUrl, xblJson, ct: ct);
        var xbl = Json.DeserializeApi<XboxResponse>(xblRaw)
                  ?? throw new InvalidOperationException("Xbox Live authentication failed.");
        var xblToken = xbl.Token ?? throw new InvalidOperationException("Missing Xbox Live token.");

        // 2. XSTS authorization
        var xstsJson = Json.Serialize(new
        {
            Properties = new
            {
                SandboxId = "RETAIL",
                UserTokens = new[] { xblToken }
            },
            RelyingParty = "rp://api.minecraftservices.com/",
            TokenType = "JWT"
        });
        var xstsRaw = await _http.PostJsonAsync(XstsAuthUrl, xstsJson, ct: ct);
        var xsts = Json.DeserializeApi<XboxResponse>(xstsRaw);
        var xstsToken = xsts?.Token ?? throw new InvalidOperationException("XSTS authorization failed. The account may not own Minecraft.");
        var userHash = xsts?.DisplayClaims?.Xui?.FirstOrDefault()?.UserHash ?? "";

        // 3. Minecraft login
        var mcJson = Json.Serialize(new { identityToken = $"XBL3.0 x={userHash};{xstsToken}" });
        var mcRaw = await _http.PostJsonAsync(MinecraftLoginUrl, mcJson, ct: ct);
        var mc = Json.DeserializeApi<MinecraftLoginResponse>(mcRaw)
                 ?? throw new InvalidOperationException("Minecraft login failed. This account may not own Minecraft.");

        // 4. Profile
        var profileJson = await _http.GetStringAsync(MinecraftProfileUrl, ct);
        var profile = Json.DeserializeApi<MinecraftProfile>(profileJson)
                      ?? new MinecraftProfile();

        var activeSkin = profile?.Skins?.FirstOrDefault(s => s.State == "ACTIVE");
        var account = new Launcher.Models.Account
        {
            Type = Launcher.Models.AccountType.Microsoft,
            Uuid = profile.Id ?? Guid.NewGuid().ToString("N").Replace("-", ""),
            Username = profile.Name ?? "Player",
            AccessToken = mc.AccessToken ?? "",
            RefreshToken = token.RefreshToken ?? "",
            MicrosoftAccessToken = token.AccessToken ?? "",
            UserHash = userHash,
            XboxUserId = xsts?.DisplayClaims?.Xui?.FirstOrDefault()?.Xid ?? "",
            ExpiresAt = DateTimeOffset.UtcNow.AddSeconds(token.ExpiresIn > 0 ? token.ExpiresIn : 3600),
            CreatedAt = DateTimeOffset.UtcNow,
            SkinUrl = activeSkin?.Url ?? "",
            SkinVariant = activeSkin?.Variant ?? ""
        };
        account.UsernameHistory.Add(account.Username);
        return account;
    }

    /// <summary>
    /// Refreshes an expired account using its refresh token. Returns a copy of
    /// the account with fresh tokens when possible.
    /// </summary>
    public async Task<Launcher.Models.Account?> RefreshAsync(Launcher.Models.Account account, string clientId, CancellationToken ct = default)
    {
        if (string.IsNullOrEmpty(account.RefreshToken)) return null;
        try
        {
            var form = new Dictionary<string, string>
            {
                ["grant_type"] = "refresh_token",
                ["client_id"] = clientId,
                ["refresh_token"] = account.RefreshToken,
                ["scope"] = Scope
            };
            var raw = await _http.PostFormAsync(TokenUrl, form, ct);
            var token = Json.DeserializeApi<TokenResponse>(raw);
            if (token is null || string.IsNullOrEmpty(token.AccessToken)) return null;

            var refreshed = await ExchangeForMinecraftAccountAsync(token, ct);
            refreshed.UsernameHistory = account.UsernameHistory;
            refreshed.CreatedAt = account.CreatedAt;
            refreshed.LastUsedAt = account.LastUsedAt;
            return refreshed;
        }
        catch
        {
            return null;
        }
    }

    /// <summary>
    /// Uploads a local PNG skin for the account and returns the new active skin
    /// URL, or null when the response did not include one.
    /// </summary>
    public async Task<string?> ChangeSkinAsync(
        string accessToken, string variant, string pngPath, CancellationToken ct = default)
    {
        var bytes = await File.ReadAllBytesAsync(pngPath, ct);
        var raw = await _http.SendMultipartAsync(
            HttpMethod.Put,
            MinecraftSkinsUrl,
            accessToken,
            new[] { new KeyValuePair<string, string>("variant", variant) },
            fileFieldName: "file",
            fileName: Path.GetFileName(pngPath),
            bytes,
            ct);
        var profile = Json.DeserializeApi<MinecraftProfile>(raw);
        return profile?.Skins?.FirstOrDefault(s => s.State == "ACTIVE")?.Url;
    }

    /// <summary>Removes the active skin, returning the player to the default skin.</summary>
    public async Task ResetSkinAsync(string accessToken, CancellationToken ct = default)
    {
        var raw = await _http.GetStringAsync(MinecraftProfileUrl, ct);
        var profile = Json.DeserializeApi<MinecraftProfile>(raw);
        var skin = profile?.Skins?.FirstOrDefault(s => s.State == "ACTIVE");
        if (skin?.Id is null) return;
        await _http.DeleteAsync($"{MinecraftSkinsUrl}/{skin.Id}", accessToken, ct);
    }

    /// <summary>Returns the URL of the account's active skin, or null when not set.</summary>
    public async Task<string?> GetActiveSkinUrlAsync(string accessToken, CancellationToken ct = default)
    {
        var raw = await _http.GetStringAsync(MinecraftProfileUrl, ct);
        var profile = Json.DeserializeApi<MinecraftProfile>(raw);
        return profile?.Skins?.FirstOrDefault(s => s.State == "ACTIVE")?.Url;
    }
}

/// <summary>Status reported while polling the device code flow.</summary>
public enum PollState
{
    Pending,
    Completed,
    Failed
}

/// <summary>A polling status update.</summary>
public sealed class DeviceCodePollStatus
{
    public PollState State { get; set; }
    public string? Message { get; set; }
}

/// <summary>Device code response from Microsoft.</summary>
public sealed class DeviceCodeInfo
{
    [JsonPropertyName("device_code")] public string DeviceCode { get; set; } = "";
    [JsonPropertyName("user_code")] public string UserCode { get; set; } = "";
    [JsonPropertyName("verification_uri")] public string VerificationUri { get; set; } = "";
    [JsonPropertyName("expires_in")] public int ExpiresIn { get; set; }
    [JsonPropertyName("interval")] public int Interval { get; set; }
    [JsonPropertyName("message")] public string? Message { get; set; }
}

internal sealed class TokenResponse
{
    [JsonPropertyName("access_token")] public string? AccessToken { get; set; }
    [JsonPropertyName("refresh_token")] public string? RefreshToken { get; set; }
    [JsonPropertyName("expires_in")] public int ExpiresIn { get; set; }
}

internal sealed class DeviceCodeError
{
    [JsonPropertyName("error")] public string? Error { get; set; }
}

internal sealed class XboxResponse
{
    [JsonPropertyName("Token")] public string? Token { get; set; }
    [JsonPropertyName("DisplayClaims")] public DisplayClaims? DisplayClaims { get; set; }
}

internal sealed class DisplayClaims
{
    [JsonPropertyName("xui")] public List<XuiClaim> Xui { get; set; } = new();
}

internal sealed class XuiClaim
{
    [JsonPropertyName("uhs")] public string? UserHash { get; set; }
    [JsonPropertyName("xid")] public string? Xid { get; set; }
}

internal sealed class MinecraftLoginResponse
{
    [JsonPropertyName("access_token")] public string? AccessToken { get; set; }
}

internal sealed class MinecraftProfile
{
    [JsonPropertyName("id")] public string? Id { get; set; }
    [JsonPropertyName("name")] public string? Name { get; set; }
    [JsonPropertyName("skins")] public List<MinecraftSkin>? Skins { get; set; }
}

internal sealed class MinecraftSkin
{
    [JsonPropertyName("id")] public string? Id { get; set; }
    [JsonPropertyName("state")] public string? State { get; set; }
    [JsonPropertyName("url")] public string? Url { get; set; }
    [JsonPropertyName("variant")] public string? Variant { get; set; }
}
