using Launcher.ViewModels;

namespace Launcher.Views;

/// <summary>
/// Static access point used by view controls to resolve their view model from
/// the composition root (wired once at startup by the UI project).
/// </summary>
public static class AppHost
{
    public static ServiceHub? Services { get; set; }
}
