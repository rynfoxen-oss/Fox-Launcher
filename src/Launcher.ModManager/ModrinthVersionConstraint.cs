using System.Text.RegularExpressions;

namespace Launcher.ModManager;

/// <summary>
/// Compares Minecraft mod version strings and evaluates Modrinth version-range
/// expressions (e.g. "&gt;=0.9.1", "&lt;1.11.3", "1.16.5-1.19.2").
/// Version strings like "mc26.2-0.9.2-alpha.4-fabric" or "1.11.2+mc26.2" are
/// reduced to their mod version core before comparing.
/// </summary>
internal static class ModrinthVersionConstraint
{
    /// <summary>Returns true when <paramref name="versionNumber"/> falls inside the range.</summary>
    public static bool RangeMatches(string? versionRange, string? versionNumber)
    {
        if (string.IsNullOrWhiteSpace(versionRange) || string.IsNullOrWhiteSpace(versionNumber)) return true;
        foreach (var alt in versionRange.Split(',').Select(a => a.Trim()).Where(a => a.Length > 0))
        {
            if (RangeSingleMatches(alt, versionNumber)) return true;
        }
        return false;
    }

    private static bool RangeSingleMatches(string range, string version)
    {
        var m = Regex.Match(range, @"^\s*(>=|<=|==|=|>|<)?\s*(.*)$");
        var op = m.Groups[1].Value;
        var target = m.Groups[2].Value.Trim();
        if (op.Length == 0 && target.Contains('-'))
        {
            var parts = target.Split('-', 2);
            if (parts.Length == 2)
            {
                var lo = parts[0].Trim();
                var hi = parts[1].Trim();
                return (string.IsNullOrEmpty(lo) || Compare(version, lo) >= 0)
                    && (string.IsNullOrEmpty(hi) || Compare(version, hi) <= 0);
            }
        }
        var c = Compare(version, target);
        return op switch
        {
            ">=" => c >= 0,
            ">" => c > 0,
            "<=" => c <= 0,
            "<" => c < 0,
            "=" or "==" => c == 0,
            _ => c == 0
        };
    }

    /// <summary>Compares two mod version strings. Pre-releases sort below the release.</summary>
    public static int Compare(string a, string b)
    {
        var (na, pa) = ParseVersion(a);
        var (nb, pb) = ParseVersion(b);
        var len = Math.Max(na.Length, nb.Length);
        for (var i = 0; i < len; i++)
        {
            var x = i < na.Length ? na[i] : 0;
            var y = i < nb.Length ? nb[i] : 0;
            if (x != y) return x < y ? -1 : 1;
        }
        var preA = !string.IsNullOrEmpty(pa);
        var preB = !string.IsNullOrEmpty(pb);
        if (preA == preB) return string.Compare(pa, pb, StringComparison.OrdinalIgnoreCase);
        return preA ? -1 : 1;
    }

    /// <summary>Reduces a mod version string to its numeric core + pre-release tag.</summary>
    public static (int[] Numbers, string Pre) ParseVersion(string? v)
    {
        if (string.IsNullOrWhiteSpace(v)) return (Array.Empty<int>(), "");
        var s = v.Trim();
        s = Regex.Replace(s, @"^mc\d+(\.\d+)*\s*[-+]\s*", "", RegexOptions.IgnoreCase);
        s = Regex.Replace(s, @"[+\-]mc[\d.]+$", "", RegexOptions.IgnoreCase);
        s = Regex.Replace(s, @"[-+]?(fabric|forge|neoforge|quilt)$", "", RegexOptions.IgnoreCase);
        var m = Regex.Match(s, @"^\s*(\d+(?:\.\d+)*)(?:[.+-]([0-9A-Za-z][0-9A-Za-z.-]*))?\s*$");
        if (!m.Success) return (Array.Empty<int>(), "");
        var numbers = m.Groups[1].Value
            .Split('.')
            .Select(seg => int.TryParse(seg, out var n) ? n : 0)
            .ToArray();
        return (numbers, m.Groups[2].Value);
    }
}
