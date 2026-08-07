using System.Text.Json.Serialization;
using System.Text.RegularExpressions;

namespace Launcher.Models;

/// <summary>A news article shown on the home page / news feed.</summary>
public sealed class NewsItem
{
    public string Title { get; set; } = "";
    public string? Body { get; set; }
    public string? Category { get; set; }
    public string? ImageUrl { get; set; }
    public string? LinkUrl { get; set; }
    public DateTimeOffset PublishedAt { get; set; }
}

/// <summary>A launcher change-log entry (shown in the update / changelog panel).</summary>
public sealed class ChangelogEntry
{
    public string Version { get; set; } = "";
    public DateTimeOffset Date { get; set; }
    public List<string> Changes { get; set; } = new();
}

/// <summary>Result of an auto-update check.</summary>
public sealed class UpdateInfo
{
    public string LatestVersion { get; set; } = "";
    public string? DownloadUrl { get; set; }
    public string? Sha256 { get; set; }
    public string? Notes { get; set; }
    public DateTimeOffset ReleasedAt { get; set; }

    /// <summary>
    /// True when the latest release is strictly newer than the running version.
    /// Uses flexible numeric parsing and compares prereleases as lower than the
    /// corresponding release.
    /// </summary>
    public bool IsUpdateAvailable
    {
        get
        {
            if (string.IsNullOrWhiteSpace(DownloadUrl)) return false;
            return Version.TryParse(LatestVersion, out var latest)
                && Version.TryParse(AppInfo.Version, out var current)
                && latest.CompareTo(current) > 0;
        }
    }

    /// <summary>Minimal numeric version used for update ordering.</summary>
    private readonly struct Version : IComparable<Version>
    {
        private readonly int[] _segments;
        public bool IsPreRelease { get; }

        public Version(int[] segments, bool isPreRelease)
        {
            _segments = segments;
            IsPreRelease = isPreRelease;
        }

        public static bool TryParse(string? raw, out Version version)
        {
            version = default;
            if (string.IsNullOrWhiteSpace(raw)) return false;
            var s = raw.Trim();
            if (s.StartsWith("v", StringComparison.OrdinalIgnoreCase)) s = s[1..];

            var plusIndex = s.IndexOf('+');
            if (plusIndex >= 0) s = s[..plusIndex];

            var dashIndex = s.IndexOf('-');
            var isPreRelease = dashIndex >= 0;
            var core = dashIndex >= 0 ? s[..dashIndex] : s;
            if (string.IsNullOrWhiteSpace(core)) return false;

            var match = Regex.Match(core, @"\d+(?:\.\d+)*");
            if (!match.Success) return false;
            var segments = match.Value.Split('.').Select(part => int.TryParse(part, out var value) ? value : -1).ToArray();
            if (segments.Any(value => value < 0)) return false;

            segments = TrimTrailingZeros(segments);
            if (segments.Length == 0) segments = new[] { 0 };

            version = new Version(segments, isPreRelease);
            return true;
        }

        private static int[] TrimTrailingZeros(int[] segments)
        {
            var last = segments.Length - 1;
            while (last > 0 && segments[last] == 0)
            {
                last--;
            }
            if (last == segments.Length - 1) return segments;
            var trimmed = new int[last + 1];
            Array.Copy(segments, trimmed, last + 1);
            return trimmed;
        }

        public int CompareTo(Version other)
        {
            var maxLength = Math.Max(_segments.Length, other._segments.Length);
            for (var i = 0; i < maxLength; i++)
            {
                var a = i < _segments.Length ? _segments[i] : 0;
                var b = i < other._segments.Length ? other._segments[i] : 0;
                var cmp = a.CompareTo(b);
                if (cmp != 0) return cmp;
            }

            if (!IsPreRelease && other.IsPreRelease) return 1;
            if (IsPreRelease && !other.IsPreRelease) return -1;
            return 0;
        }
    }
}
