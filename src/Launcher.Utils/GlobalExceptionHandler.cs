namespace Launcher.Utils;

/// <summary>
/// App-wide exception hook. Ensures the launcher never crashes without a
/// friendly message and log entry. Wired up in App.xaml.cs.
/// </summary>
public static class GlobalExceptionHandler
{
    /// <summary>Called for every unhandled exception.</summary>
    public static event Action<Exception, string>? Unhandled;

    /// <summary>Raises the exception to all subscribers.</summary>
    public static void Handle(Exception ex, string context = "unknown")
    {
        try
        {
            Unhandled?.Invoke(ex, context);
        }
        catch
        {
            // Never throw from the handler itself.
        }
    }

    /// <summary>
    /// Returns a sanitized user-facing message, falling back to the exception
    /// message when nothing friendlier can be extracted.
    /// </summary>
    public static string ToFriendly(Exception ex)
    {
        if (ex is IOException && ex.Message.Contains("network", StringComparison.OrdinalIgnoreCase))
            return "A network error occurred. Check your connection and try again.";
        if (ex is UnauthorizedAccessException)
            return "Access denied. Try running the launcher as administrator.";
        if (ex is System.Net.Http.HttpRequestException)
            return "Could not reach the server. Check your internet connection and retry.";
        return ex.Message;
    }
}
