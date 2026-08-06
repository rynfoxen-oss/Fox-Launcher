using System.Text;

namespace Launcher.Utils;

/// <summary>
/// Builds a Windows command line with correct quoting for arguments that
/// contain spaces or special characters.
/// </summary>
public static class ArgBuilder
{
    /// <summary>Quotes an argument following Windows cmdline rules.</summary>
    public static string Quote(string value)
    {
        if (string.IsNullOrEmpty(value)) return "\"\"";
        if (!value.Any(char.IsWhiteSpace) && !value.Contains('"') && !value.Contains('\\')) return value;

        var sb = new StringBuilder("\"");
        var backslashes = 0;
        foreach (var ch in value)
        {
            if (ch == '\\')
            {
                backslashes++;
            }
            else if (ch == '"')
            {
                sb.Append('\\', backslashes * 2 + 1);
                sb.Append('"');
                backslashes = 0;
            }
            else
            {
                sb.Append('\\', backslashes);
                backslashes = 0;
                sb.Append(ch);
            }
        }
        if (backslashes > 0) sb.Append('\\', backslashes * 2);
        sb.Append('"');
        return sb.ToString();
    }
}

/// <summary>Misc string extensions.</summary>
public static class StringExtensions
{
    /// <summary>Truncates a string to <paramref name="max"/> characters.</summary>
    public static string Truncate(this string value, int max)
    {
        if (string.IsNullOrEmpty(value) || value.Length <= max) return value;
        return value[..(max - 3)] + "...";
    }

    /// <summary>Returns true when the string is null, empty or whitespace.</summary>
    public static bool IsEmpty(this string? value) => string.IsNullOrWhiteSpace(value);

    /// <summary>Compares ignoring case.</summary>
    public static bool EqualsIgnoreCase(this string value, string other)
        => string.Equals(value, other, StringComparison.OrdinalIgnoreCase);

    /// <summary>Converts a Maven coordinate to a filesystem path ("net/fabricmc/fabric-loader/0.15.11/...").</summary>
    public static string MavenPath(this string coordinate)
    {
        var parts = coordinate.Split(':');
        if (parts.Length < 3) return coordinate;
        var group = parts[0].Replace('.', '/');
        var artifact = parts[1];
        var version = parts[2];
        return $"{group}/{artifact}/{version}/{artifact}-{version}.jar";
    }
}
