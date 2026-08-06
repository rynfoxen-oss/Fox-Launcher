using System.Linq;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using Launcher.ModManager;
using Launcher.Models;
using Launcher.ViewModels;

namespace Launcher.Views.Pages;

public partial class ModsPage : UserControl
{
    public ModsPage()
    {
        InitializeComponent();
        AddHandler(MouseWheelEvent, new MouseWheelEventHandler(OnPagePreviewMouseWheel), handledEventsToo: true);
        AddHandler(UIElement.PreviewMouseWheelEvent, new MouseWheelEventHandler(OnPagePreviewMouseWheel), handledEventsToo: true);

        Loaded += (_, _) =>
        {
            InstalledList?.AddHandler(UIElement.PreviewMouseWheelEvent, new MouseWheelEventHandler(OnListBoxPreviewMouseWheel), handledEventsToo: true);
            BrowseList?.AddHandler(UIElement.PreviewMouseWheelEvent, new MouseWheelEventHandler(OnListBoxPreviewMouseWheel), handledEventsToo: true);
        };
    }

    private void OnPagePreviewMouseWheel(object sender, MouseWheelEventArgs e)
    {
        if (e.OriginalSource is not DependencyObject source) return;

        var scrollViewer = GetTargetScrollViewer(source);
        if (scrollViewer == null) return;

        ScrollViewerWheel(scrollViewer, e.Delta);
        e.Handled = true;
    }

    private void OnListBoxPreviewMouseWheel(object sender, MouseWheelEventArgs e)
    {
        if (sender is not DependencyObject source) return;
        if (FindVisualChild<ScrollViewer>(source) is not ScrollViewer scrollViewer) return;

        ScrollViewerWheel(scrollViewer, e.Delta);
        e.Handled = true;
    }

    private static ScrollViewer? GetTargetScrollViewer(DependencyObject source)
    {
        if (FindVisualParent<ListBox>(source) is ListBox listBox && FindVisualChild<ScrollViewer>(listBox) is ScrollViewer listScrollViewer)
            return listScrollViewer;

        return FindVisualParent<ScrollViewer>(source);
    }

    private static void ScrollViewerWheel(ScrollViewer scrollViewer, int delta)
    {
        var offset = scrollViewer.VerticalOffset - (delta / 3.0);
        scrollViewer.ScrollToVerticalOffset(offset);
    }

    private static T? FindVisualChild<T>(DependencyObject parent) where T : DependencyObject
    {
        for (var i = 0; i < VisualTreeHelper.GetChildrenCount(parent); i++)
        {
            var child = VisualTreeHelper.GetChild(parent, i);
            if (child is T typedChild)
                return typedChild;

            var result = FindVisualChild<T>(child);
            if (result != null)
                return result;
        }

        return null;
    }

    private static T? FindVisualParent<T>(DependencyObject? child) where T : DependencyObject
    {
        while (child != null)
        {
            if (child is T parent)
                return parent;
            child = VisualTreeHelper.GetParent(child);
        }

        return null;
    }

    private void SuggestionList_MouseLeftButtonUp(object sender, MouseButtonEventArgs e)
    {
        if (sender is ListBox listBox && listBox.SelectedItem is ModSearcher.Suggestion suggestion)
        {
            if (DataContext is ModsViewModel vm)
            {
                vm.SearchQuery = suggestion.Text;
                vm.SearchCommand.Execute(null);
            }
        }
    }

    private void InstalledList_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (sender is ListBox { DataContext: ModsViewModel vm } listBox)
        {
            vm.SetSelectedMods(listBox.SelectedItems.Cast<ModInfo>().ToList());
        }
    }

    private void OnManageMenuOpen(object sender, RoutedEventArgs e)
    {
        if (sender is not Button { ContextMenu: { } menu }) return;
        menu.DataContext = DataContext;
        menu.PlacementTarget = (UIElement)sender;
        menu.IsOpen = true;
    }
}
