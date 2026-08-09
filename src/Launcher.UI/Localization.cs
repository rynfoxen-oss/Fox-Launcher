using System.ComponentModel;
using System.Windows;
using System.Windows.Data;
using System.Windows.Markup;
using Launcher.Views;

namespace Launcher.UI;

/// <summary>
/// WPF markup extension that resolves a localized string from the current
/// <see cref="Services.LocalizationService"/> via the active <see cref="AppHost"/>.
/// Usage: <c>Text="{loc:String Home.Play}"</c>. Also fires when the language
/// changes, so re-translation happens without a window close.
/// </summary>
[MarkupExtensionReturnType(typeof(string))]
public sealed class LocStringExtension : MarkupExtension
{
    public string Key { get; set; } = "";

    public LocStringExtension() { }
    public LocStringExtension(string key) { Key = key; }

    public override object ProvideValue(IServiceProvider serviceProvider)
    {
        if (string.IsNullOrEmpty(Key)) return "";
        return new LocStringBinding(Key);
    }

    private sealed class LocStringBinding : Binding
    {
        public LocStringBinding(string key)
        {
            Mode = BindingMode.OneWay;
            Source = LocSource.Instance;
            Path = new PropertyPath($"Item[{key}]");
        }
    }
}

/// <summary>
/// Singleton dictionary-backed source for all <see cref="LocStringExtension"/>
/// bindings. Refreshed when the language changes so every visible string
/// re-translates without a window close.
/// </summary>
public sealed class LocSource : INotifyPropertyChanged
{
    public static readonly LocSource Instance = new();

    private readonly Dictionary<string, string> _cache = new(StringComparer.OrdinalIgnoreCase);

    public event PropertyChangedEventHandler? PropertyChanged;

    public string this[string key]
    {
        get
        {
            if (string.IsNullOrEmpty(key)) return "";
            if (_cache.TryGetValue(key, out var cached)) return cached;
            var localized = AppHost.Services?.Localization.Translate(key) ?? key;
            _cache[key] = localized;
            return localized;
        }
    }

    public void Refresh()
    {
        _cache.Clear();
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs("Item[]"));
    }
}
