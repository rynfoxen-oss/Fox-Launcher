using System.ComponentModel;
using System.Runtime.CompilerServices;
using System.Text.Json.Serialization;

namespace Launcher.Models;

/// <summary>A shader pack installed in an instance's <c>shaderpacks/</c> folder.</summary>
public sealed class ShaderPackInfo
{
    public string FileName { get; set; } = "";
    public string? Title { get; set; }
    public string? Description { get; set; }
    public string? IconUrl { get; set; }
    public long Size { get; set; }
    public DateTimeOffset AddedAt { get; set; } = DateTimeOffset.UtcNow;

    [JsonIgnore]
    public string FullPath { get; set; } = "";
}

/// <summary>A resource pack installed in an instance's <c>resourcepacks/</c> folder.</summary>
public sealed class ResourcePackInfo
{
    public string FileName { get; set; } = "";
    public string? Title { get; set; }
    public string? Description { get; set; }
    public string? IconUrl { get; set; }
    public bool Enabled { get; set; } = true;
    public long Size { get; set; }
    public DateTimeOffset AddedAt { get; set; } = DateTimeOffset.UtcNow;

    [JsonIgnore]
    public string FullPath { get; set; } = "";

    [JsonIgnore]
    public string DiskName => Enabled ? FileName : $".{FileName}";
}

/// <summary>A Minecraft world inside an instance's <c>saves/</c> folder.</summary>
public sealed class WorldInfo
{
    public string Name { get; set; } = "";
    public string FolderName { get; set; } = "";
    public DateTimeOffset LastPlayed { get; set; } = DateTimeOffset.MinValue;
    public long Size { get; set; }
    public string? GameMode { get; set; }
    public string? Difficulty { get; set; }

    /// <summary>Path of the world icon.png (may not exist).</summary>
    public string? IconPath { get; set; }
}

/// <summary>A screenshot in an instance's <c>screenshots/</c> folder.</summary>
public sealed class ScreenshotInfo
{
    public string FileName { get; set; } = "";
    public DateTimeOffset TakenAt { get; set; }
    public long Size { get; set; }
    public string FullPath { get; set; } = "";
}

/// <summary>A saved multiplayer server.</summary>
public sealed class ServerEntry : INotifyPropertyChanged
{
    public string Name { get; set; } = "";
    public string Ip { get; set; } = "";
    public int Port { get; set; } = 25565;
    public string? Description { get; set; }
    public bool IsFavorite { get; set; }
    public string? IconUrl { get; set; }

    // ---- Runtime server status (never persisted) ----

    [JsonIgnore] private bool _isChecking;
    [JsonIgnore] public bool IsChecking
    {
        get => _isChecking;
        set
        {
            if (_isChecking == value) return;
            _isChecking = value;
            OnPropertyChanged();
            OnPropertyChanged(nameof(StatusText));
        }
    }

    [JsonIgnore] private bool _isOnline;
    [JsonIgnore] public bool IsOnline
    {
        get => _isOnline;
        set
        {
            if (_isOnline == value) return;
            _isOnline = value;
            OnPropertyChanged();
            OnPropertyChanged(nameof(StatusText));
        }
    }

    [JsonIgnore] private string _motd = "";
    [JsonIgnore] public string Motd
    {
        get => _motd;
        set
        {
            if (_motd == value) return;
            _motd = value;
            OnPropertyChanged();
        }
    }

    [JsonIgnore] private string _version = "";
    [JsonIgnore] public string Version
    {
        get => _version;
        set
        {
            if (_version == value) return;
            _version = value;
            OnPropertyChanged();
        }
    }

    [JsonIgnore] private int _onlinePlayers;
    [JsonIgnore] public int OnlinePlayers
    {
        get => _onlinePlayers;
        set
        {
            if (_onlinePlayers == value) return;
            _onlinePlayers = value;
            OnPropertyChanged();
            OnPropertyChanged(nameof(StatusText));
        }
    }

    [JsonIgnore] private int _maxPlayers;
    [JsonIgnore] public int MaxPlayers
    {
        get => _maxPlayers;
        set
        {
            if (_maxPlayers == value) return;
            _maxPlayers = value;
            OnPropertyChanged();
            OnPropertyChanged(nameof(StatusText));
        }
    }

    [JsonIgnore] private long _latencyMs;
    [JsonIgnore] public long LatencyMs
    {
        get => _latencyMs;
        set
        {
            if (_latencyMs == value) return;
            _latencyMs = value;
            OnPropertyChanged();
            OnPropertyChanged(nameof(StatusText));
        }
    }

    /// <summary>Short human-readable status line for the server row.</summary>
    [JsonIgnore]
    public string StatusText
    {
        get
        {
            if (IsChecking) return "Checking...";
            if (!IsOnline) return "Offline";
            return $"{OnlinePlayers}/{MaxPlayers} players · {LatencyMs} ms";
        }
    }

    public event PropertyChangedEventHandler? PropertyChanged;

    private void OnPropertyChanged([CallerMemberName] string? name = null)
        => PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}
