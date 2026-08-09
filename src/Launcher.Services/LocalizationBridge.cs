namespace Launcher.Services;

/// <summary>
/// Public bridge the ViewModels call when the user changes the active language
/// to re-emit property changes so every <c>LocStringExtension</c> updates without
/// a window close. Lives in <c>Launcher.Services</c> (not <c>Launcher.UI</c>) so
/// ViewModels can call it without depending on the UI assembly.
/// </summary>
public static class LocalizationBridge
{
    /// <summary>Notify all <c>LocStringExtension</c> bindings to re-translate.</summary>
    public static void RefreshAll()
    {
        // Reflection so the Services layer doesn't take a hard reference to
        // the UI assembly — keeps the dependency graph clean.
        var type = System.Type.GetType("Launcher.UI.LocSource, Launcher.UI", throwOnError: false);
        if (type is null) return;
        var instance = type.GetProperty("Instance", System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Static)?.GetValue(null);
        var refresh = type.GetMethod("Refresh", System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Instance);
        refresh?.Invoke(instance, null);
    }
}