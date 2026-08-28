using Launcher.Models;

namespace Launcher.Services;

/// <summary>
/// Shows transient toast notifications to the user. View models and services
/// just call <see cref="Show"/>, and the UI toast host (subscribed to
/// <see cref="Shown"/>) renders and dismisses them. Safe to call from any thread —
/// the host marshals to the UI dispatcher.
/// </summary>
public sealed class NotificationService
{
    /// <summary>Raised for every notification that should be displayed.</summary>
    public event Action<NotificationItem>? Shown;

    /// <summary>Shows a notification. Title/message are assumed to already be localized.</summary>
    public void Show(NotificationLevel level, string title, string message, TimeSpan? duration = null)
        => Shown?.Invoke(new NotificationItem(level, title, message, duration));

    /// <summary>Shows a notification with an optional action button.</summary>
    public void ShowAction(NotificationLevel level, string title, string message, string actionLabel, Action onAction, TimeSpan? duration = null)
        => Shown?.Invoke(new NotificationItem(level, title, message, duration, actionLabel, onAction));

    public void Info(string title, string message) => Show(NotificationLevel.Info, title, message);

    public void Success(string title, string message) => Show(NotificationLevel.Success, title, message);

    public void Warning(string title, string message) => Show(NotificationLevel.Warning, title, message);

    public void Error(string title, string message) => Show(NotificationLevel.Error, title, message);
}