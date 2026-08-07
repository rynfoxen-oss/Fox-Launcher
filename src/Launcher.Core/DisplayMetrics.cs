using System.Runtime.InteropServices;
using System.Runtime.Versioning;

namespace Launcher.Core;

/// <summary>
/// Reads the primary display size without depending on a UI framework, so the
/// game can be given the monitor's native resolution when launching fullscreen.
/// </summary>
public static class DisplayMetrics
{
    private const int SmCxScreen = 0;
    private const int SmCyScreen = 1;

    [DllImport("user32.dll")]
    private static extern int GetSystemMetrics(int index);

    /// <summary>Primary screen size in pixels (0 when unavailable).</summary>
    [SupportedOSPlatform("windows")]
    public static (int Width, int Height) PrimaryScreenSize
    {
        get
        {
            var width = GetSystemMetrics(SmCxScreen);
            var height = GetSystemMetrics(SmCyScreen);
            return width > 0 && height > 0 ? (width, height) : (0, 0);
        }
    }
}
