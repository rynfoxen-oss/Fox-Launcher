using Launcher.Models;
using Launcher.Utils;

namespace Launcher.Authentication;

/// <summary>
/// Persists accounts to <c>config/accounts.json</c>. Tokens are encrypted with
/// Windows DPAPI before being written to disk.
/// </summary>
public sealed class AccountManager
{
    private readonly object _lock = new();
    private readonly List<Account> _accounts = new();
    private Account? _active;

    public AccountManager()
    {
        Load();
    }

    /// <summary>All saved accounts (newest last).</summary>
    public IReadOnlyList<Account> Accounts
    {
        get
        {
            lock (_lock) return _accounts.ToList();
        }
    }

    /// <summary>The active account used for launching.</summary>
    public Account? Active
    {
        get
        {
            lock (_lock) return _active;
        }
    }

    /// <summary>Raised when the account list or the active account changes.</summary>
    public event Action? Changed;

    /// <summary>Adds or updates an account and marks it active.</summary>
    public void SaveAccount(Account account)
    {
        lock (_lock)
        {
            var existing = _accounts.FirstOrDefault(a =>
                a.Type == account.Type && (a.Uuid == account.Uuid || a.Username == account.Username));
            if (existing is not null)
            {
                var index = _accounts.IndexOf(existing);
                _accounts[index] = account;
            }
            else
            {
                _accounts.Add(account);
            }
            _active = account;
            PersistLocked();
        }
        Changed?.Invoke();
    }

    /// <summary>Sets the active account by index.</summary>
    public void SetActive(int index)
    {
        lock (_lock)
        {
            if (index < 0 || index >= _accounts.Count) return;
            _active = _accounts[index];
            PersistLocked();
        }
        Changed?.Invoke();
    }

    /// <summary>Sets the active account by reference.</summary>
    public void SetActive(Account account)
    {
        lock (_lock)
        {
            _active = account;
            PersistLocked();
        }
        Changed?.Invoke();
    }

    /// <summary>Removes an account.</summary>
    public void RemoveAccount(Account account)
    {
        lock (_lock)
        {
            _accounts.RemoveAll(a => ReferenceEquals(a, account) || a.Uuid == account.Uuid);
            if (_active == account) _active = _accounts.LastOrDefault();
            PersistLocked();
        }
        Changed?.Invoke();
    }

    /// <summary>Replaces the token-bearing fields of the active account (refresh).</summary>
    public void UpdateActiveAccount(Account updated)
    {
        lock (_lock)
        {
            if (_active is null) return;
            var index = _accounts.IndexOf(_active);
            _active = updated;
            if (index >= 0) _accounts[index] = updated;
            PersistLocked();
        }
        Changed?.Invoke();
    }

    private void Load()
    {
        var data = Json.ReadFromFile<AccountStore>(Paths.AccountsFile);
        if (data?.Accounts is null) return;
        foreach (var account in data.Accounts)
        {
            account.AccessToken = SecureStore.Decrypt(account.AccessToken);
            account.RefreshToken = SecureStore.Decrypt(account.RefreshToken);
            account.MicrosoftAccessToken = SecureStore.Decrypt(account.MicrosoftAccessToken);
            _accounts.Add(account);
        }
        _active = data.ActiveUuid is not null
            ? _accounts.FirstOrDefault(a => a.Uuid == data.ActiveUuid)
            : _accounts.LastOrDefault();
    }

    private void PersistLocked()
    {
        var store = new AccountStore
        {
            ActiveUuid = _active?.Uuid,
            Accounts = _accounts.Select(a => new Account
            {
                Type = a.Type,
                Uuid = a.Uuid,
                Username = a.Username,
                AccessToken = SecureStore.Encrypt(a.AccessToken),
                RefreshToken = SecureStore.Encrypt(a.RefreshToken),
                MicrosoftAccessToken = SecureStore.Encrypt(a.MicrosoftAccessToken),
                UserHash = a.UserHash,
                XboxUserId = a.XboxUserId,
                ExpiresAt = a.ExpiresAt,
                CreatedAt = a.CreatedAt,
                LastUsedAt = a.LastUsedAt,
                SkinUrl = a.SkinUrl,
                UsernameHistory = a.UsernameHistory.ToList()
            }).ToList()
        };
        Json.WriteToFile(Paths.AccountsFile, store);
    }

    /// <summary>Refreshable serialization shape.</summary>
    private sealed class AccountStore
    {
        public string? ActiveUuid { get; set; }
        public List<Account> Accounts { get; set; } = new();
    }
}
