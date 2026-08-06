using System.Collections;
using System.Globalization;
using System.Windows;
using System.Windows.Data;
using System.Windows.Media;

namespace Launcher.Views.Converters;

/// <summary>Converts a boolean to <see cref="Visibility"/>. Also treats positive
/// numbers, non-empty collections and non-empty strings as visible.</summary>
public sealed class BoolToVisibilityConverter : IValueConverter
{
    public object Convert(object? value, Type targetType, object? parameter, CultureInfo culture)
    {
        switch (value)
        {
            case null:
                return Visibility.Collapsed;
            case bool b:
                return b ? Visibility.Visible : Visibility.Collapsed;
            case int i:
                return i > 0 ? Visibility.Visible : Visibility.Collapsed;
            case long l:
                return l > 0 ? Visibility.Visible : Visibility.Collapsed;
            case double d:
                return d > 0 ? Visibility.Visible : Visibility.Collapsed;
            case string s:
                return s.Length > 0 ? Visibility.Visible : Visibility.Collapsed;
            case ICollection c:
                return c.Count > 0 ? Visibility.Visible : Visibility.Collapsed;
            default:
                return Visibility.Collapsed;
        }
    }

    public object ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture)
        => value is Visibility.Visible;
}

/// <summary>Converts an inverted boolean to <see cref="Visibility"/>.</summary>
public sealed class InverseBoolToVisibilityConverter : IValueConverter
{
    public object Convert(object? value, Type targetType, object? parameter, CultureInfo culture)
        => value is true ? Visibility.Collapsed : Visibility.Visible;

    public object ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture)
        => value is Visibility.Visible;
}

/// <summary>Inverts a boolean.</summary>
public sealed class InverseBooleanConverter : IValueConverter
{
    public object Convert(object? value, Type targetType, object? parameter, CultureInfo culture)
        => value is not true;

    public object ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture)
        => value is not true;
}

/// <summary>Shows a target when a value is null, hides otherwise.</summary>
public sealed class NullToVisibilityConverter : IValueConverter
{
    public object Convert(object? value, Type targetType, object? parameter, CultureInfo culture)
    {
        var invert = string.Equals(parameter as string, "invert", StringComparison.OrdinalIgnoreCase);
        var isNull = value is null;
        return (invert ? !isNull : isNull) ? Visibility.Visible : Visibility.Collapsed;
    }

    public object ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture)
        => Binding.DoNothing;
}

/// <summary>Converts a hex color string to a <see cref="SolidColorBrush"/>.</summary>
public sealed class ColorToBrushConverter : IValueConverter
{
    public object Convert(object? value, Type targetType, object? parameter, CultureInfo culture)
    {
        if (value is string hex && TryParse(hex, out var color))
            return new SolidColorBrush(color);
        if (value is SolidColorBrush brush) return brush;
        return new SolidColorBrush(Color.FromRgb(0xFF, 0x8B, 0x3D));
    }

    public object ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture)
        => Binding.DoNothing;

    private static bool TryParse(string hex, out Color color)
    {
        color = default;
        try
        {
            var brush = (SolidColorBrush)new BrushConverter().ConvertFromString(hex)!;
            color = brush.Color;
            return true;
        }
        catch
        {
            return false;
        }
    }
}

/// <summary>Converts a count to a compact label ("1.2K").</summary>
public sealed class CompactNumberConverter : IValueConverter
{
    public object Convert(object? value, Type targetType, object? parameter, CultureInfo culture)
    {
        if (value is not long n) return "0";
        if (n >= 1_000_000) return (n / 1_000_000d).ToString("0.#M", CultureInfo.InvariantCulture);
        if (n >= 1_000) return (n / 1_000d).ToString("0.#K", CultureInfo.InvariantCulture);
        return n.ToString(CultureInfo.InvariantCulture);
    }

    public object ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture)
        => Binding.DoNothing;
}

/// <summary>Converts a byte count to a human readable size.</summary>
public sealed class BytesToSizeConverter : IValueConverter
{
    public object Convert(object? value, Type targetType, object? parameter, CultureInfo culture)
        => value is long bytes ? Launcher.Utils.Format.Bytes(bytes) : "0 B";

    public object ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture)
        => Binding.DoNothing;
}

/// <summary>Converts a double fraction (0..1) to a percent string.</summary>
public sealed class FractionToPercentConverter : IValueConverter
{
    public object Convert(object? value, Type targetType, object? parameter, CultureInfo culture)
        => value is double d ? $"{Math.Round(d * 100)}%" : "0%";

    public object ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture)
        => Binding.DoNothing;
}

/// <summary>Converts a DateTimeOffset to a relative string ("2h ago").</summary>
public sealed class RelativeTimeConverter : IValueConverter
{
    public object Convert(object? value, Type targetType, object? parameter, CultureInfo culture)
        => value is DateTimeOffset dto ? Launcher.Utils.Format.RelativeTime(dto) : "";

    public object ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture)
        => Binding.DoNothing;
}
