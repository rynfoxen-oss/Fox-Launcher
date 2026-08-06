using System.Reflection;

namespace Launcher.Services;

/// <summary>
/// Lightweight localization service. Translations ship as embedded JSON
/// resources (<c>Lang.*.json</c>) inside this assembly. UI strings fall back to
/// English keys when a translation is missing.
/// </summary>
public sealed class LocalizationService
{
    private readonly Dictionary<string, Dictionary<string, string>> _tables = new();
    private readonly Dictionary<string, string> _english = new(StringComparer.OrdinalIgnoreCase);
    private string _current = "en";

    public LocalizationService()
    {
        var assembly = Assembly.GetExecutingAssembly();
        foreach (var resourceName in assembly.GetManifestResourceNames())
        {
            if (!resourceName.EndsWith(".json", StringComparison.OrdinalIgnoreCase)) continue;
            var match = System.Text.RegularExpressions.Regex.Match(resourceName, @"Lang\.([a-z]{2})\.json", System.Text.RegularExpressions.RegexOptions.IgnoreCase);
            if (!match.Success) continue;
            var code = match.Groups[1].Value.ToLowerInvariant();
            try
            {
                using var stream = assembly.GetManifestResourceStream(resourceName);
                if (stream is null) continue;
                using var reader = new StreamReader(stream);
                var table = System.Text.Json.JsonSerializer.Deserialize<Dictionary<string, string>>(reader.ReadToEnd());
                if (table is null) continue;
                if (code == "en") _english = table;
                else _tables[code] = table;
            }
            catch { /* ignore broken resource */ }
        }
    }

    /// <summary>Switches the active language.</summary>
    public void SetLanguage(string code) => _current = code.ToLowerInvariant();

    /// <summary>Current language code.</summary>
    public string CurrentLanguage => _current;

    /// <summary>Translates a key, falling back to English and then the key itself.</summary>
    public string Translate(string key)
    {
        if (_tables.TryGetValue(_current, out var table) && table.TryGetValue(key, out var localized))
            return localized;
        return _english.TryGetValue(key, out var en) ? en : key;
    }
}
