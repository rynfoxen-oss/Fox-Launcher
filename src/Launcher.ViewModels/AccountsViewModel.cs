using Launcher.Authentication;
using Launcher.Models;
using Launcher.Utils;

namespace Launcher.ViewModels;

/// <summary>
/// Account management page: Microsoft login (device code flow), offline
/// profiles, account switching and removal.
/// </summary>
public sealed class AccountsViewModel : ViewModelBase
{
    private IReadOnlyList<Account> _accounts = Array.Empty<Account>();
    private Account? _active;
    private bool _isLoggingIn;
    private bool _showDeviceCode;
    private string _deviceCode = "";
    private string _verificationUri = "";
    private string _offlineName = "";
    private string _status = "";
    private string _activeSkinUrl = "";
    private bool _isSlimVariant;
    private bool _isSkinBusy;

    public AccountsViewModel(ServiceHub services) : base(services)
    {
        MicrosoftLoginCommand = new AsyncRelayCommand(MicrosoftLoginAsync);
        OfflineLoginCommand = new RelayCommand(OfflineLogin);
        RefreshAccountsCommand = new RelayCommand(RefreshAccounts);
        SwitchCommand = new RelayCommand(p =>
        {
            if (p is Account account) Services.Accounts.SetActive(account);
        });
        RemoveCommand = new RelayCommand(Remove);
        CopyCodeCommand = new RelayCommand(() => SetClipboard(DeviceCode));
        ChangeSkinCommand = new AsyncRelayCommand(ChangeSkinAsync);
        ResetSkinCommand = new AsyncRelayCommand(ResetSkinAsync);

        services.Accounts.Changed += RefreshAccounts;
        RefreshAccounts();
    }

    public AsyncRelayCommand MicrosoftLoginCommand { get; }
    public RelayCommand OfflineLoginCommand { get; }
    public RelayCommand RefreshAccountsCommand { get; }
    public RelayCommand SwitchCommand { get; }
    public RelayCommand RemoveCommand { get; }
    public RelayCommand CopyCodeCommand { get; }
    public AsyncRelayCommand ChangeSkinCommand { get; }
    public AsyncRelayCommand ResetSkinCommand { get; }

    public IReadOnlyList<Account> Accounts
    {
        get => _accounts;
        private set => SetProperty(ref _accounts, value);
    }

    public Account? Active
    {
        get => _active;
        private set => SetProperty(ref _active, value);
    }

    public bool IsLoggingIn
    {
        get => _isLoggingIn;
        private set => SetProperty(ref _isLoggingIn, value);
    }

    public bool ShowDeviceCode
    {
        get => _showDeviceCode;
        private set => SetProperty(ref _showDeviceCode, value);
    }

    public string DeviceCode
    {
        get => _deviceCode;
        private set => SetProperty(ref _deviceCode, value);
    }

    public string VerificationUri
    {
        get => _verificationUri;
        private set => SetProperty(ref _verificationUri, value);
    }

    public string OfflineName
    {
        get => _offlineName;
        set => SetProperty(ref _offlineName, value);
    }

    public string Status
    {
        get => _status;
        private set => SetProperty(ref _status, value);
    }

    public string ActiveSkinUrl
    {
        get => _activeSkinUrl;
        private set
        {
            if (SetProperty(ref _activeSkinUrl, value)) OnPropertyChanged(nameof(SkinHint));
        }
    }

    public bool IsSlimVariant
    {
        get => _isSlimVariant;
        set => SetProperty(ref _isSlimVariant, value);
    }

    public bool IsSkinBusy
    {
        get => _isSkinBusy;
        private set => SetProperty(ref _isSkinBusy, value);
    }

    public bool HasActiveAccount => Active is not null;

    /// <summary>Caption under the skin preview explaining what is shown.</summary>
    public string SkinHint =>
        string.IsNullOrWhiteSpace(ActiveSkinUrl)
            ? "No custom skin yet — the default skin is shown. Click Change skin to set one."
            : Active?.Type == AccountType.Microsoft
                ? "This skin is synced to your Microsoft account."
                : "Local skin for this offline profile. It appears in-game only on Fabric instances.";

    private async Task MicrosoftLoginAsync()
    {
        if (IsLoggingIn) return;
        IsLoggingIn = true;
        ShowDeviceCode = false;
        Status = "Requesting Microsoft device code...";
        try
        {
            var clientId = Services.Settings.MicrosoftClientId;
            if (Services.Settings.IsMicrosoftClientIdPlaceholder() || !Services.Settings.IsMicrosoftClientIdConfigured())
            {
                Status = "Microsoft login is not configured. Set the Azure client id in settings.json, or use an offline profile.";
                Services.Log.Warn("Microsoft client id not configured.");
                return;
            }

            var deviceCode = await Services.MicrosoftAuth.RequestDeviceCodeAsync(clientId);
            DeviceCode = deviceCode.UserCode;
            VerificationUri = deviceCode.VerificationUri;
            ShowDeviceCode = true;
            Status = $"Enter {deviceCode.UserCode} at microsoft.com/link to sign in.";

            var account = await Services.MicrosoftAuth.CompleteLoginAsync(
                deviceCode, clientId,
                onStatus: s => Status = s.Message ?? Status);

            account.LastUsedAt = DateTimeOffset.UtcNow;
            Services.Accounts.SaveAccount(account);
            ShowDeviceCode = false;
            Status = $"Signed in as {account.Username}.";
        }
        catch (Exception ex)
        {
            Status = $"Login failed: {ex.Message}";
            Services.Log.Error("Microsoft login failed", ex);
        }
        finally
        {
            IsLoggingIn = false;
        }
    }

    private void OfflineLogin()
    {
        var name = string.IsNullOrWhiteSpace(OfflineName) ? "Player" : OfflineName.Trim();
        var account = Services.OfflineAuth.CreateOfflineAccount(name);
        Services.Accounts.SaveAccount(account);
        Status = $"Created offline profile '{account.Username}'.";
        OfflineName = "";
    }

    private void Remove(object? parameter)
    {
        var account = parameter as Account ?? Active;
        if (account is null) return;
        if (Services.ConfirmDialog?.Invoke("Remove account", $"Remove '{account.Username}'?") == false) return;
        Services.Accounts.RemoveAccount(account);
        Status = $"Removed '{account.Username}'.";
    }

    private async Task ChangeSkinAsync()
    {
        var account = Active;
        if (account is null) return;

        var path = Services.PickFileDialog?.Invoke("PNG images (*.png)|*.png|All files (*.*)|*.*");
        if (string.IsNullOrEmpty(path)) return;

        IsSkinBusy = true;
        try
        {
            if (account.Type == AccountType.Microsoft && !string.IsNullOrEmpty(account.AccessToken))
            {
                Status = "Uploading skin...";
                var variant = IsSlimVariant ? "SLIM" : "CLASSIC";
                var url = await Services.MicrosoftAuth.ChangeSkinAsync(account.AccessToken, variant, path);
                if (url is null)
                {
                    Status = "Skin uploaded, but the server did not return a preview URL.";
                }
                else
                {
                    account.SkinUrl = url;
                    Services.Accounts.SaveAccount(account);
                    ActiveSkinUrl = url;
                    Status = "Skin updated. It will appear in-game.";
                }
            }
            else if (account.Type == AccountType.Offline)
            {
                var dest = Paths.LocalSkinFile(account.Uuid);
                Directory.CreateDirectory(Paths.Skins);
                File.Copy(path, dest, overwrite: true);

                account.SkinUrl = new Uri(dest).AbsoluteUri;
                Services.Accounts.SaveAccount(account);
                ActiveSkinUrl = account.SkinUrl;
                Status = "Skin saved for this offline profile. It is shown in the launcher; play it on a Fabric instance to see it in-game.";
            }
            else
            {
                Status = "Skin uploads require a signed-in Microsoft account.";
            }
        }
        catch (Exception ex)
        {
            Status = $"Skin update failed: {ex.Message}";
            Services.Log.Error("Skin upload failed", ex);
        }
        finally
        {
            IsSkinBusy = false;
        }
    }

    private async Task ResetSkinAsync()
    {
        var account = Active;
        if (account is null) return;

        IsSkinBusy = true;
        try
        {
            if (account.Type == AccountType.Microsoft && !string.IsNullOrEmpty(account.AccessToken))
            {
                Status = "Resetting skin...";
                await Services.MicrosoftAuth.ResetSkinAsync(account.AccessToken);
                account.SkinUrl = "";
                Services.Accounts.SaveAccount(account);
                ActiveSkinUrl = "";
                Status = "Skin reset to the default.";
            }
            else if (account.Type == AccountType.Offline)
            {
                var dest = Paths.LocalSkinFile(account.Uuid);
                if (File.Exists(dest)) File.Delete(dest);
                account.SkinUrl = "";
                Services.Accounts.SaveAccount(account);
                ActiveSkinUrl = "";
                Status = "Skin reset to the default.";
            }
            else
            {
                Status = "Only Microsoft and offline accounts have a skin to reset.";
            }
        }
        catch (Exception ex)
        {
            Status = $"Skin reset failed: {ex.Message}";
            Services.Log.Error("Skin reset failed", ex);
        }
        finally
        {
            IsSkinBusy = false;
        }
    }

    private void RefreshAccounts()
    {
        Accounts = Services.Accounts.Accounts;
        Active = Services.Accounts.Active;
        ActiveSkinUrl = Active?.SkinUrl ?? "";
        OnPropertyChanged(nameof(HasActiveAccount));
    }

    private static void SetClipboard(string text)
    {
        // The UI layer wires a clipboard delegate to avoid WPF dependencies here.
        ServiceHub.ClipboardSetter?.Invoke(text);
    }
}
