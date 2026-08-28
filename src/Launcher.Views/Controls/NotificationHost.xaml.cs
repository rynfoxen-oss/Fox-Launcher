using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media.Animation;
using System.Windows.Threading;
using Launcher.Models;
using Launcher.Services;
using Launcher.ViewModels;
using Launcher.Views.Converters;

namespace Launcher.Views.Controls;

/// <summary>
/// Hosts transient toast notifications in the corner of the launcher. Subscribes
/// to <see cref="NotificationService.Shown"/> in <c>Loaded</c> and manages
/// animation, auto-dismiss and a generous on-screen cap (oldest first).
/// </summary>
public partial class NotificationHost : UserControl
{
    private const int MaxVisible = 5;

    private readonly Dictionary<Guid, DispatcherTimer> _timers = new();
    private NotificationService? _service;
    private bool _reduceMotion;

    public NotificationHost()
    {
        InitializeComponent();
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
    }

    private void OnLoaded(object? sender, RoutedEventArgs e)
    {
        _reduceMotion = AppHost.Services?.Settings.DisableAnimations ?? false;
        _service = AppHost.Services?.Notifications;
        if (_service is not null)
        {
            _service.Shown += OnNotificationShown;
        }
    }

    private void OnUnloaded(object? sender, RoutedEventArgs e)
    {
        if (_service is not null)
        {
            _service.Shown -= OnNotificationShown;
            _service = null;
        }

        foreach (var timer in _timers.Values)
        {
            timer.Stop();
        }
        _timers.Clear();
        Host.Children.Clear();
    }

    private void OnNotificationShown(NotificationItem item)
    {
        if (!Dispatcher.CheckAccess())
        {
            Dispatcher.BeginInvoke(() => OnNotificationShown(item));
            return;
        }

        AddToast(item);
    }

    private void AddToast(NotificationItem item)
    {
        // Duplicate prevention: if the same toast (level + title + message) is
        // already on screen, reset its auto-dismiss timer instead of stacking a
        // second identical card.
        if (TryResetExisting(item)) return;

        while (Host.Children.Count >= MaxVisible)
        {
            var oldest = Host.Children[0] as ContentControl;
            if ((oldest?.Content as NotificationItem)?.Id is { } oldId)
            {
                _timers.Remove(oldId);
            }
            Host.Children.RemoveAt(0);
        }

        var toast = new ContentControl
        {
            ContentTemplate = (DataTemplate)FindResource("ToastTemplate"),
            Content = item
        };
        Host.Children.Add(toast);

        if (!_reduceMotion)
        {
            var translate = new System.Windows.Media.TranslateTransform(40, 0);
            toast.RenderTransform = translate;
            toast.BeginAnimation(UIElement.OpacityProperty,
                new DoubleAnimation(0, 1, TimeSpan.FromSeconds(0.18)));
            translate.BeginAnimation(System.Windows.Media.TranslateTransform.XProperty,
                new DoubleAnimation(40, 0, TimeSpan.FromSeconds(0.24)));
        }

        ScheduleDismiss(item, toast);
    }

    /// <summary>
    /// Finds an active toast matching the incoming item (same level, title and
    /// message). If one exists, restarts its dismiss timer and returns true.
    /// </summary>
    private bool TryResetExisting(NotificationItem item)
    {
        foreach (var child in Host.Children)
        {
            if (child is not ContentControl cc) continue;
            if (cc.Content is not NotificationItem existing) continue;
            if (existing.Level == item.Level
                && string.Equals(existing.Title, item.Title, StringComparison.Ordinal)
                && string.Equals(existing.Message, item.Message, StringComparison.Ordinal))
            {
                if (_timers.TryGetValue(existing.Id, out var timer))
                {
                    timer.Stop();
                    timer.Interval = item.Duration;
                    timer.Start();
                }
                return true;
            }
        }
        return false;
    }

    private void ScheduleDismiss(NotificationItem item, ContentControl toast)
    {
        var timer = new DispatcherTimer { Interval = item.Duration };
        timer.Tick += (_, _) =>
        {
            timer.Stop();
            _timers.Remove(item.Id);
            Dismiss(toast);
        };
        _timers[item.Id] = timer;
        timer.Start();
    }

    private void Dismiss(ContentControl toast)
    {
        if (!Host.Children.Contains(toast)) return;

        var item = toast.Content as NotificationItem;
        var reduce = _reduceMotion;

        void Remove()
        {
            _timers.TryGetValue((item?.Id) ?? Guid.Empty, out var t);
            t?.Stop();
            if (item is not null) _timers.Remove(item.Id);
            Host.Children.Remove(toast);
        }

        if (reduce)
        {
            Remove();
            return;
        }

        var translate = toast.RenderTransform as System.Windows.Media.TranslateTransform ?? new System.Windows.Media.TranslateTransform();
        toast.RenderTransform = translate;

        var fade = new DoubleAnimation(1, 0, TimeSpan.FromSeconds(0.16)) { BeginTime = TimeSpan.FromSeconds(0.05) };
        fade.Completed += (_, _) => Remove();
        toast.BeginAnimation(UIElement.OpacityProperty, fade);
        translate.BeginAnimation(System.Windows.Media.TranslateTransform.XProperty,
            new DoubleAnimation(0, 40, TimeSpan.FromSeconds(0.2)));
    }

    private void OnToastDismissClick(object sender, RoutedEventArgs e)
    {
        if (sender is Button { DataContext: NotificationItem item })
        {
            Dismiss(FindToast(item)!);
        }
    }

    private void OnToastActionClick(object sender, RoutedEventArgs e)
    {
        if (sender is Button { DataContext: NotificationItem item })
        {
            Dismiss(FindToast(item)!);
            item.OnAction?.Invoke();
        }
    }

    private ContentControl? FindToast(NotificationItem item)
    {
        foreach (var child in Host.Children)
        {
            if (child is ContentControl cc && ReferenceEquals(cc.Content, item)) return cc;
        }
        return null;
    }
}