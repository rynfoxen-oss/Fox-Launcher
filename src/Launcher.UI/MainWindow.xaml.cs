using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Media.Animation;
using Launcher.ViewModels;

namespace Launcher.UI;

public partial class MainWindow : Window
{
    private readonly ServiceHub _hub;
    private readonly MainViewModel _vm;
    private readonly SearchViewModel _search;
    private bool _syncingNav;

    public MainWindow(ServiceHub hub)
    {
        _hub = hub;
        InitializeComponent();
        _vm = hub.Container.Resolve<MainViewModel>();
        _search = hub.Container.Resolve<SearchViewModel>();
        SearchOverlay.DataContext = _search;
        DataContext = _vm;
        _vm.PropertyChanged += OnVmPropertyChanged;
        StateChanged += OnWindowStateChanged;

        Loaded += (_, _) =>
        {
            App.Instance.ApplyTheme();
            SyncNavSelection();
            ClampToWorkArea();
        };
    }

    protected override void OnPreviewKeyDown(KeyEventArgs e)
    {
        var ctrl = (Keyboard.Modifiers & ModifierKeys.Control) == ModifierKeys.Control;

        switch (e.Key)
        {
            case Key.F when ctrl:
            case Key.K when ctrl:
                _search.Open();
                e.Handled = true;
                return;
            case Key.N when ctrl:
                _vm.Navigate<InstancesViewModel>();
                e.Handled = true;
                return;
            case Key.OemComma when ctrl:
                _vm.Navigate<SettingsViewModel>();
                e.Handled = true;
                return;
            case Key.Escape:
                if (_search.IsOpen)
                {
                    _search.Close();
                    e.Handled = true;
                }
                return;
        }

        base.OnPreviewKeyDown(e);
    }

    private void OnWindowStateChanged(object? sender, EventArgs e)
    {
        // Swap the chrome glyph between maximize/restore as the state changes.
        var maximized = WindowState == WindowState.Maximized;
        MaximizeButton.Content = maximized ? "\uE923" : "\uE922";
        ToolTipService.SetToolTip(MaximizeButton, maximized ? "Restore" : "Maximize");
    }

    protected override void OnSourceInitialized(EventArgs e)
    {
        base.OnSourceInitialized(e);
        var helper = new WindowInteropHelper(this);
        if (helper.Handle != IntPtr.Zero)
        {
            HwndSource.FromHwnd(helper.Handle)?.AddHook(WndProc);
        }
    }

    // Borderless (WindowStyle=None) windows ignore the taskbar's work area when
    // maximized, so the window covers the taskbar. WM_GETMINMAXINFO lets us
    // constrain the maximize bounds to the monitor's work area instead.
    private const int WmGetMinMaxInfo = 0x0024;
    private const int MonitorDefaultToNearest = 0x00000002;

    [StructLayout(LayoutKind.Sequential)]
    private struct NativePoint { public int X; public int Y; }

    [StructLayout(LayoutKind.Sequential)]
    private struct NativeRect { public int Left; public int Top; public int Right; public int Bottom; }

    [StructLayout(LayoutKind.Sequential)]
    private struct MinMaxInfo
    {
        public NativePoint Reserved;
        public NativePoint MaxSize;
        public NativePoint MaxPosition;
        public NativePoint MinTrackSize;
        public NativePoint MaxTrackSize;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct MonitorInfo
    {
        public int Size;
        public NativeRect Monitor;
        public NativeRect WorkArea;
        public int Flags;
    }

    [DllImport("user32.dll")]
    private static extern IntPtr MonitorFromWindow(IntPtr hwnd, int flags);

    [DllImport("user32.dll")]
    private static extern bool GetMonitorInfo(IntPtr hMonitor, ref MonitorInfo lpmi);

    private const int WmDpiChanged = 0x02E0;

    /// <summary>
    /// Ensures the window fits entirely within the working area of the monitor
    /// it is shown on. On small screens or high DPI the fixed default size
    /// (1180x760 DIPs) can exceed the visible area, which would otherwise clip
    /// the bottom/right of the window (the "only see half" symptom).
    /// </summary>
    private void ClampToWorkArea()
    {
        if (WindowState != WindowState.Normal) return;

        var hwnd = new WindowInteropHelper(this).Handle;
        if (hwnd == IntPtr.Zero) return;
        var monitor = MonitorFromWindow(hwnd, MonitorDefaultToNearest);
        if (monitor == IntPtr.Zero) return;
        var info = new MonitorInfo { Size = Marshal.SizeOf<MonitorInfo>() };
        if (!GetMonitorInfo(monitor, ref info)) return;

        var scale = Math.Max(VisualTreeHelper.GetDpi(this).PixelsPerDip, 1.0);
        const int margin = 24;
        var left = info.WorkArea.Left / scale;
        var top = info.WorkArea.Top / scale;
        var right = info.WorkArea.Right / scale;
        var bottom = info.WorkArea.Bottom / scale;

        // Shrink only if the default size exceeds the screen; never grow.
        if (Width > right - left - margin)
        {
            Width = Math.Max(MinWidth, right - left - margin);
        }
        if (Height > bottom - top - margin)
        {
            Height = Math.Max(MinHeight, bottom - top - margin);
        }

        // Pull the window back onto the screen if any edge is outside.
        if (Left < left) Left = left;
        if (Top < top) Top = top;
        if (Left + Width > right) Left = right - Width;
        if (Top + Height > bottom) Top = bottom - Height;
    }

    private IntPtr WndProc(IntPtr hwnd, int msg, IntPtr wParam, IntPtr lParam, ref bool handled)
    {
        if (msg == WmGetMinMaxInfo)
        {
            var monitor = MonitorFromWindow(hwnd, MonitorDefaultToNearest);
            if (monitor != IntPtr.Zero)
            {
                var info = new MonitorInfo { Size = Marshal.SizeOf<MonitorInfo>() };
                if (GetMonitorInfo(monitor, ref info))
                {
                    var mmi = Marshal.PtrToStructure<MinMaxInfo>(lParam);
                    mmi.MaxPosition.X = info.WorkArea.Left;
                    mmi.MaxPosition.Y = info.WorkArea.Top;
                    mmi.MaxSize.X = info.WorkArea.Right - info.WorkArea.Left;
                    mmi.MaxSize.Y = info.WorkArea.Bottom - info.WorkArea.Top;
                    Marshal.StructureToPtr(mmi, lParam, true);
                    handled = true;
                }
            }
        }
        else if (msg == WmDpiChanged)
        {
            // The DPI-aware WPF window resizes automatically; re-clamp once
            // layout settles so it never ends up larger than the work area.
            Dispatcher.BeginInvoke(new Action(ClampToWorkArea),
                System.Windows.Threading.DispatcherPriority.Loaded);
        }
        return IntPtr.Zero;
    }

    private void OnVmPropertyChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (e.PropertyName == nameof(MainViewModel.CurrentPage))
        {
            SyncNavSelection();
            AnimatePageTransition();
        }
        else if (e.PropertyName == nameof(MainViewModel.IsSidebarCollapsed))
        {
            ApplySidebar();
        }
    }

    /// <summary>
    /// Gentle fade when switching pages. Skipped entirely when the user enabled
    /// "Reduce UI effects", so the option genuinely removes the animation.
    /// </summary>
    private void AnimatePageTransition()
    {
        if (_hub.Settings.DisableAnimations) return;

        PageHost.BeginAnimation(UIElement.OpacityProperty, null);
        PageHost.Opacity = 0.45;
        var fade = new DoubleAnimation(0.45, 1, TimeSpan.FromMilliseconds(160));
        PageHost.BeginAnimation(UIElement.OpacityProperty, fade);
    }

    private void ApplySidebar()
    {
        var collapsed = _vm.IsSidebarCollapsed;
        var target = collapsed ? 60d : 220d;
        if (Math.Abs(SidebarColumn.Width.Value - target) < 0.5) return;

        var animation = new GridLengthAnimation
        {
            From = new GridLength(SidebarColumn.Width.Value),
            To = new GridLength(target),
            Duration = TimeSpan.FromMilliseconds(180)
        };
        SidebarColumn.BeginAnimation(ColumnDefinition.WidthProperty, animation);

        // Toggle visibility of expanded-only elements
        LogoText.Visibility = collapsed ? Visibility.Collapsed : Visibility.Visible;
        InstanceLabel.Visibility = collapsed ? Visibility.Collapsed : Visibility.Visible;
        InstanceCombo.Visibility = collapsed ? Visibility.Collapsed : Visibility.Visible;
        AccountInfo.Visibility = collapsed ? Visibility.Collapsed : Visibility.Visible;
        ToggleGlyph.Text = collapsed ? "\uE701" : "\uE700";
        ToggleSidebarBtn.ToolTip = collapsed ? "Expand sidebar" : "Collapse sidebar";
    }

    private void SyncNavSelection()
    {
        if (_syncingNav) return;
        _syncingNav = true;
        try
        {
            var item = _vm.Pages.FirstOrDefault(p => ReferenceEquals(p.ViewModel, _vm.CurrentPage));
            if (item is null)
            {
                NavList.SelectedItem = null;
            }
            else if (!ReferenceEquals(NavList.SelectedItem, item))
            {
                NavList.SelectedItem = item;
            }
        }
        finally
        {
            _syncingNav = false;
        }
    }

    private void OnNavSelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (_syncingNav) return;
        if (NavList.SelectedItem is NavItem item)
        {
            _vm.Navigate(item);
        }
    }

    private void OnTitleBarMouseDown(object sender, MouseButtonEventArgs e)
    {
        if (e.ChangedButton == MouseButton.Left)
        {
            DragMove();
        }
    }

    private void OnMinimizeClick(object sender, RoutedEventArgs e) => WindowState = WindowState.Minimized;

    private void OnMaximizeClick(object sender, RoutedEventArgs e)
        => WindowState = WindowState == WindowState.Maximized ? WindowState.Normal : WindowState.Maximized;

    private void OnCloseClick(object sender, RoutedEventArgs e) => Close();

    protected override void OnClosed(EventArgs e)
    {
        _vm.PropertyChanged -= OnVmPropertyChanged;
        base.OnClosed(e);
    }
}
