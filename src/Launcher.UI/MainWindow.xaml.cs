using System.ComponentModel;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
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
