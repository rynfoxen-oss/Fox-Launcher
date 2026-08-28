namespace Launcher.Models;

/// <summary>Severity of a user notification.</summary>
public enum NotificationLevel
{
    Info,
    Success,
    Warning,
    Error
}

/// <summary>
/// A transient user-facing notification shown as a toast in the corner of the
/// launcher. Created by <c>NotificationService</c> and rendered by the toast host.
/// </summary>
public sealed class NotificationItem
{
    public NotificationItem(
        NotificationLevel level,
        string title,
        string message,
        TimeSpan? duration = null,
        string? actionLabel = null,
        Action? onAction = null)
    {
        Level = level;
        Title = title;
        Message = message;
        Duration = duration ?? (level == NotificationLevel.Error ? TimeSpan.FromSeconds(10) : TimeSpan.FromSeconds(5));
        ActionLabel = actionLabel;
        OnAction = onAction;
    }

    /// <summary>Stable identity so the host can manage dismissal timers.</summary>
    public Guid Id { get; } = Guid.NewGuid();

    public NotificationLevel Level { get; }

    public string Title { get; }

    public string Message { get; }

    /// <summary>How long the toast stays visible before auto-dismissing.</summary>
    public TimeSpan Duration { get; }

    /// <summary>Optional action button label ("Open logs", "Retry", ...).</summary>
    public string? ActionLabel { get; }

    /// <summary>Invoked when the action button is pressed (may be null).</summary>
    public Action? OnAction { get; }

    /// <summary>Friendly label for accessibility tools.</summary>
    public string LevelLabel => Level switch
    {
        NotificationLevel.Success => "Success",
        NotificationLevel.Warning => "Warning",
        NotificationLevel.Error => "Error",
        _ => "Information"
    };
}