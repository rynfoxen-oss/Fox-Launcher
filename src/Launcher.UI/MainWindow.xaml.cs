using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Interop;
using Launcher.ViewModels;

namespace Launcher.UI;

public partial class MainWindow : Window
{
    private readonly ServiceHub _hub;
    private readonly MainViewModel _vm;
    private bool _syncingNav;

    public MainWindow(ServiceHub hub)
    {
        _hub = hub;
        InitializeComponent();
        _vm = hub.Container.Resolve<MainViewModel>();
        DataContext = _vm;
        _vm.PropertyChanged += OnVmPropertyChanged;

        Loaded += (_, _) =>
        {
            App.Instance.ApplyTheme();
            SyncNavSelection();
        };
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
        return IntPtr.Zero;
    }

    private void OnVmPropertyChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (e.PropertyName == nameof(MainViewModel.CurrentPage))
        {
            SyncNavSelection();
        }
        else if (e.PropertyName == nameof(MainViewModel.IsSidebarCollapsed))
        {
            ApplySidebar();
        }
    }

    private void ApplySidebar()
    {
        var width = _vm.IsSidebarCollapsed ? 0d : 220d;
        SidebarColumn.Width = new GridLength(width);
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
