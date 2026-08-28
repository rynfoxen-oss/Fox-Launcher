using System.Globalization;

namespace Launcher.Utils;

/// <summary>Formatting helpers for file sizes, durations and speeds.</summary>
public static class Format
{
    private static readonly string[] SizeSuffixes = { "B", "KB", "MB", "GB", "TB" };

    /// <summary>Formats a byte count as a human readable string ("4.0 MB").</summary>
    public static string Bytes(long bytes)
    {
        if (bytes < 0) return "0 B";
        var i = 0;
        double value = bytes;
        while (value >= 1024 && i < SizeSuffixes.Length - 1)
        {
            value /= 1024;
            i++;
        }
        return value.ToString(i == 0 ? "0" : "0.0", CultureInfo.InvariantCulture) + " " + SizeSuffixes[i];
    }

    /// <summary>Formats a byte/second rate ("2.4 MB/s").</summary>
    public static string Speed(double bytesPerSecond) => $"{Bytes((long)bytesPerSecond)}/s";

    /// <summary>Formats a timespan as "mm:ss" or "h:mm:ss".</summary>
    public static string Time(TimeSpan span)
    {
        if (span < TimeSpan.Zero) span = TimeSpan.Zero;
        return span.TotalHours >= 1
            ? $"{(int)span.TotalHours}:{span.Minutes:00}:{span.Seconds:00}"
            : $"{span.Minutes:00}:{span.Seconds:00}";
    }

    /// <summary>Formats a time relative to now ("2h ago").</summary>
    public static string RelativeTime(DateTimeOffset time)
    {
        var diff = DateTimeOffset.UtcNow - time;
        if (diff < TimeSpan.FromSeconds(60)) return "just now";
        if (diff < TimeSpan.FromMinutes(60)) return $"{(int)diff.TotalMinutes}m ago";
        if (diff < TimeSpan.FromHours(24)) return $"{(int)diff.TotalHours}h ago";
        if (diff < TimeSpan.FromDays(30)) return $"{(int)diff.TotalDays}d ago";
        return time.LocalDateTime.ToString("MMM d, yyyy", CultureInfo.InvariantCulture);
    }
}

/// <summary>Minecraft-style version comparison (1.20.1 &gt; 1.20, 1.9 &gt; 1.8.9).</summary>
public static class VersionCompare
{
    /// <summary>Compares two dotted numeric versions. Returns &lt;0, 0 or &gt;0.</summary>
    public static int Compare(string? a, string? b)
    {
        if (string.IsNullOrWhiteSpace(a)) return string.IsNullOrWhiteSpace(b) ? 0 : -1;
        if (string.IsNullOrWhiteSpace(b)) return 1;

        var pa = a.Split('.', '-', '+');
        var pb = b.Split('.', '-', '+');
        var len = Math.Max(pa.Length, pb.Length);
        for (var i = 0; i < len; i++)
        {
            var va = i < pa.Length && long.TryParse(pa[i], out var n) ? n : 0;
            var vb = i < pb.Length && long.TryParse(pb[i], out var m) ? m : 0;
            if (va != vb) return va.CompareTo(vb);
        }
        return 0;
    }

    /// <summary>IComparer view for use with LINQ OrderBy / OrderByDescending.</summary>
    public sealed class Comparer : IComparer<string>
    {
        public static readonly Comparer Instance = new();
        public int Compare(string? a, string? b) => VersionCompare.Compare(a, b);
    }
}

/// <summary>Identifier helpers.</summary>
public static class Ids
{
    /// <summary>Generates a URL-safe, filesystem-safe unique id.</summary>
    public static string New() => Guid.NewGuid().ToString("N")[..12];

    /// <summary>Sanitises a name into a safe folder name.</summary>
    public static string Safe(string value)
    {
        var invalid = Path.GetInvalidFileNameChars().ToHashSet();
        var sb = new System.Text.StringBuilder();
        foreach (var ch in value.Trim())
        {
            if (invalid.Contains(ch)) sb.Append('_');
            else sb.Append(ch);
        }
        return sb.ToString();
    }
}
