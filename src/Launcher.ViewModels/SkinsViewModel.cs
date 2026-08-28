using System.Collections.ObjectModel;
using System.IO;
using System.Security.Cryptography;
using Launcher.Authentication;
using Launcher.Models;
using Launcher.Utils;

namespace Launcher.ViewModels;

/// <summary>
/// Skin library page: 3D preview of the selected skin, a browsable/searchable
/// library of saved skins, and one-click apply to the active account.
/// </summary>
public sealed class SkinsViewModel : ViewModelBase
{
    private readonly List<SavedSkin> _all = new();
    private ObservableCollection<SavedSkin> _skins = new();
    private SavedSkin? _selectedSkin;
    private string? _selectedSkinId;
    private string _searchText = "";
    private string _sortBy = "Newest";
    private bool _isGrid = true;
    private bool _isBusy;
    private string _status = "";

    public SkinsViewModel(ServiceHub services) : base(services)
    {
        ImportCommand = new RelayCommand(Import);
        DeleteCommand = new RelayCommand(p => Delete(p as SavedSkin ?? SelectedSkin));
        RenameCommand = new RelayCommand(p => Rename(p as SavedSkin ?? SelectedSkin));
        ToggleFavoriteCommand = new RelayCommand(p =>
        {
            var skin = p as SavedSkin ?? SelectedSkin;
            if (skin is not null) Services.SkinLibrary.SetFavorite(skin, !skin.IsFavorite);
        });
        ToggleModelCommand = new RelayCommand(p =>
        {
            var skin = p as SavedSkin ?? SelectedSkin;
            if (skin is not null) Services.SkinLibrary.SetSlim(skin, !skin.IsSlim);
        });
        ApplyCommand = new AsyncRelayCommand(ApplyAsync, _ => SelectedSkin is not null);
        ExportCommand = new AsyncRelayCommand(ExportAsync, _ => SelectedSkin is not null);
        ToggleViewCommand = new RelayCommand(() => IsGrid = !IsGrid);
        OpenFolderCommand = new RelayCommand(() => Services.SkinLibrary.OpenFolder());
        NavigateAccountsCommand = new RelayCommand(() => Services.Container.Resolve<MainViewModel>().NavigateAccounts());

        RefreshLibrary();
        Services.SkinLibrary.Changed += RefreshLibrary;
        services.Accounts.Changed += () =>
        {
            OnPropertyChanged(nameof(HasActiveAccount));
            OnPropertyChanged(nameof(ActiveAccountName));
            OnPropertyChanged(nameof(PreviewUrl));
            OnPropertyChanged(nameof(PreviewModelPreference));
        };
    }

    public RelayCommand ImportCommand { get; }
    public RelayCommand DeleteCommand { get; }
    public RelayCommand RenameCommand { get; }
    public RelayCommand ToggleFavoriteCommand { get; }
    public RelayCommand ToggleModelCommand { get; }
    public AsyncRelayCommand ApplyCommand { get; }
    public AsyncRelayCommand ExportCommand { get; }
    public RelayCommand ToggleViewCommand { get; }
    public RelayCommand OpenFolderCommand { get; }
    public RelayCommand NavigateAccountsCommand { get; }

    /// <summary>Filtered + sorted skins shown in the grid/list.</summary>
    public ObservableCollection<SavedSkin> Skins
    {
        get => _skins;
        private set => SetProperty(ref _skins, value);
    }

    public SavedSkin? SelectedSkin
    {
        get => _selectedSkin;
        set
        {
            if (SetProperty(ref _selectedSkin, value))
            {
                // Remember the skin by id so the selection survives list
                // refreshes (WPF clears SelectedItem when ItemsSource is
                // swapped, which writes null back through the binding) and
                // page re-entry.
                if (value is not null) _selectedSkinId = value.Id;
                ApplyCommand.RaiseCanExecuteChanged();
                ExportCommand.RaiseCanExecuteChanged();
                OnPropertyChanged(nameof(PreviewUrl));
                OnPropertyChanged(nameof(PreviewModelPreference));
                OnPropertyChanged(nameof(HasSelection));
                OnPropertyChanged(nameof(SelectionName));
                OnPropertyChanged(nameof(SelectionDetails));
            }
        }
    }

    public bool HasSelection => SelectedSkin is not null;

    public string SelectionName => SelectedSkin?.Name ?? "No skin selected";

    public string SelectionDetails => SelectedSkin is null
        ? "Pick a skin from the library"
        : $"{SelectedSkin.ModelLabel} model · {SelectedSkin.DimensionsLabel}";

    public string SearchText
    {
        get => _searchText;
        set
        {
            if (SetProperty(ref _searchText, value)) RefreshView();
        }
    }

    /// <summary>One of "Newest", "Name", "Favorites first".</summary>
    public string SortBy
    {
        get => _sortBy;
        set
        {
            if (SetProperty(ref _sortBy, value)) RefreshView();
        }
    }

    public bool IsGrid
    {
        get => _isGrid;
        set => SetProperty(ref _isGrid, value);
    }

    public bool IsBusy
    {
        get => _isBusy;
        private set => SetProperty(ref _isBusy, value);
    }

    public string Status
    {
        get => _status;
        private set => SetProperty(ref _status, value);
    }

    public bool HasActiveAccount => Services.Accounts.Active is not null;

    public string ActiveAccountName => Services.Accounts.Active?.Username ?? "";

    /// <summary>Texture shown in the 3D preview (selected skin or the active account's).</summary>
    public string PreviewUrl
        => SelectedSkin is { FilePath: { Length: > 0 } path } ? path
            : Services.Accounts.Active?.SkinUrl ?? "";

    /// <summary>Model preference for the preview: the skin's variant when
    /// selected, otherwise the active account's declared variant, else auto.</summary>
    public string PreviewModelPreference
    {
        get
        {
            if (SelectedSkin is not null) return SelectedSkin.IsSlim ? "Slim" : "Classic";
            return Services.Accounts.Active?.SkinVariant switch
            {
                "SLIM" => "Slim",
                "CLASSIC" => "Classic",
                _ => "Auto"
            };
        }
    }

    /// <summary>Count label in the toolbar, e.g. "12 skins".</summary>
    public string CountLabel => $"{_all.Count} skin{(_all.Count == 1 ? "" : "s")}";

    private void RefreshLibrary()
    {
        var existing = _all.ToDictionary(s => s.Id);
        foreach (var skin in Services.SkinLibrary.Skins)
        {
            if (!existing.ContainsKey(skin.Id)) _all.Add(skin);
        }
        _all.RemoveAll(s => Services.SkinLibrary.Skins.All(x => x.Id != s.Id));
        OnPropertyChanged(nameof(CountLabel));
        RefreshView();
    }

    private void RefreshView()
    {
        var query = SearchText?.Trim().ToLowerInvariant() ?? "";
        IEnumerable<SavedSkin> items = _all
            .Where(s => query.Length == 0
                        || s.Name.ToLowerInvariant().Contains(query)
                        || s.SourceName.ToLowerInvariant().Contains(query));

        items = SortBy switch
        {
            "Name" => items.OrderBy(s => s.Name, StringComparer.CurrentCultureIgnoreCase),
            "Favorites first" => items.OrderByDescending(s => s.IsFavorite).ThenByDescending(s => s.AddedAt),
            _ => items.OrderByDescending(s => s.AddedAt)
        };

        Skins = new ObservableCollection<SavedSkin>(items);
        RestoreSelection();
    }

    /// <summary>Re-selects the remembered skin after the list was rebuilt. A
    /// ListBox drops its selection (and pushes null through the binding) whenever
    /// its ItemsSource changes, even if the same item is still present, so the
    /// id-based selection is restored here to keep the highlight and preview.</summary>
    private void RestoreSelection()
    {
        if (_selectedSkin is not null && Skins.Contains(_selectedSkin)) return;
        if (_selectedSkinId is null) return;
        var match = _all.FirstOrDefault(s => s.Id == _selectedSkinId);
        if (match is not null && Skins.Contains(match))
        {
            SelectedSkin = match;
        }
    }

    /// <summary>Re-shows the page: revert the transient preview selection so the
    /// grid and preview reflect the account's actually-applied skin instead of
    /// the last skin that was merely clicked. The applied skin is matched
    /// against the library by content; when it can't be matched (e.g. a skin
    /// uploaded through a Microsoft account) the selection clears and the
    /// preview falls back to the account's applied texture directly.</summary>
    public void OnPageShown()
    {
        var account = Services.Accounts.Active;
        if (account is null)
        {
            SelectedSkin = null;
            return;
        }

        var appliedPath = AppliedSkinLocalPath(account);
        if (appliedPath is not null && File.Exists(appliedPath))
        {
            var appliedHash = GetFileHash(appliedPath);
            if (appliedHash is not null)
            {
                var match = _all.FirstOrDefault(s =>
                    File.Exists(s.FilePath) && string.Equals(GetFileHash(s.FilePath), appliedHash, StringComparison.Ordinal));
                if (match is not null)
                {
                    SelectedSkin = match;
                    return;
                }
            }
        }
        SelectedSkin = null;
    }

    /// <summary>Local file behind the account's applied skin, when any.
    /// Offline copies live on disk; Microsoft textures are remote URLs.</summary>
    private static string? AppliedSkinLocalPath(Account account)
    {
        if (string.IsNullOrEmpty(account.SkinUrl)) return null;
        if (Uri.TryCreate(account.SkinUrl, UriKind.Absolute, out var uri) && uri.Scheme == "file")
        {
            return uri.LocalPath; // LocalPath drops any cache-buster query
        }
        return null;
    }

    private static string? GetFileHash(string path)
    {
        try
        {
            using var sha = SHA256.Create();
            using var fs = File.OpenRead(path);
            return Convert.ToHexString(sha.ComputeHash(fs));
        }
        catch
        {
            return null;
        }
    }

    private void Import()
    {
        var path = Services.PickFileDialog?.Invoke("PNG images (*.png)|*.png|All files (*.*)|*.*");
        if (string.IsNullOrEmpty(path)) return;

        var skin = Services.SkinLibrary.Import(path);
        if (skin is null)
        {
            Services.Notifications.Error("Import failed", "That file is not a readable PNG skin.");
            return;
        }

        SelectedSkin = skin;
        Status = $"Imported '{skin.Name}'.";
        Services.Notifications.Success("Skin imported", $"'{skin.Name}' was added to your library.");
    }

    private void Delete(SavedSkin? skin)
    {
        if (skin is null) return;
        if (Services.ConfirmDialog?.Invoke("Delete skin", $"Remove '{skin.Name}' from your library?") == false) return;

        if (Services.SkinLibrary.Delete(skin))
        {
            if (ReferenceEquals(SelectedSkin, skin)) SelectedSkin = null;
            Status = $"Deleted '{skin.Name}'.";
            Services.Notifications.Info("Skin removed", $"'{skin.Name}' was deleted from your library.");
        }
    }

    private void Rename(SavedSkin? skin)
    {
        if (skin is null) return;
        var name = Services.RenamePrompt?.Invoke("Rename skin", skin.Name);
        if (string.IsNullOrWhiteSpace(name)) return;

        Services.SkinLibrary.Rename(skin, name);
        Status = $"Renamed to '{skin.Name}'.";
    }

    private async Task ApplyAsync()
    {
        var skin = SelectedSkin;
        var account = Services.Accounts.Active;
        if (skin is null) return;

        if (account is null)
        {
            Services.Notifications.Warning("No account", "Add an account first, then apply a skin to it.");
            Main?.NavigateAccounts();
            return;
        }

        IsBusy = true;
        try
        {
            if (account.Type == AccountType.Microsoft && !string.IsNullOrEmpty(account.AccessToken))
            {
                var variant = skin.IsSlim ? "SLIM" : "CLASSIC";
                var url = await Services.MicrosoftAuth.ChangeSkinAsync(account.AccessToken, variant, skin.FilePath);
                if (url is null)
                {
                    Status = "Skin was uploaded, but the server returned no preview URL.";
                    Services.Notifications.Warning("Skin applied", "The skin was uploaded, but the server returned no preview URL.");
                }
                else
                {
                    account.SkinUrl = AddCacheBuster(url);
                    account.SkinVariant = variant;
                    Services.Accounts.SaveAccount(account);
                    Status = $"Applied '{skin.Name}' to '{account.Username}'.";
                    Services.Notifications.Success("Skin applied", $"'{skin.Name}' is now the active skin for '{account.Username}'.");
                }
            }
            else if (account.Type == AccountType.Offline)
            {
                var dest = Paths.LocalSkinFile(account.Uuid);
                Directory.CreateDirectory(Paths.Skins);
                File.Copy(skin.FilePath, dest, overwrite: true);

                account.SkinUrl = AddCacheBuster(new Uri(dest).AbsoluteUri);
                account.SkinVariant = skin.IsSlim ? "SLIM" : "CLASSIC";
                Services.Accounts.SaveAccount(account);
                Status = $"Applied '{skin.Name}' to '{account.Username}' (offline).";
                Services.Notifications.Success("Skin applied",
                    $"'{skin.Name}' is now the skin for '{account.Username}'. Play on a Fabric instance to see it in-game.");
            }
            else
            {
                Services.Notifications.Warning("Cannot apply skin", "Sign in with a Microsoft account, or use an offline profile.");
            }
        }
        catch (Exception ex)
        {
            Services.Log.Error("Skin apply failed", ex);
            Status = $"Apply failed: {ex.Message}";
            Services.Notifications.Error("Could not apply skin", ex.Message);
        }
        finally
        {
            IsBusy = false;
        }
    }

    private static string AddCacheBuster(string url)
    {
        char sep = url.Contains('?') ? '&' : '?';
        return $"{url}{sep}v={DateTime.UtcNow.Ticks}";
    }

    private async Task ExportAsync()
    {
        var skin = SelectedSkin;
        if (skin is null) return;

        var (title, initial) = (skin.Name, $"{skin.Name}.png");
        var path = Services.PickFolderDialog?.Invoke();
        if (string.IsNullOrEmpty(path)) return;

        await Task.Yield();
        if (Services.SkinLibrary.Export(skin, Path.Combine(path, initial)))
        {
            Status = $"Exported '{skin.Name}'.";
            Services.Notifications.Success("Skin exported", $"Saved to {Path.Combine(path, initial)}");
        }
        else
        {
            Services.Notifications.Error("Export failed", "Could not write the skin file.");
        }
    }

    private MainViewModel? Main => Services.Container.Resolve<MainViewModel>();
}