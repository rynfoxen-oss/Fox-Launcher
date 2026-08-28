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
    }

    /// <summary>
    /// Slows down mouse-wheel scrolling on the mod lists by scrolling a smaller
    /// pixel delta per notch instead of WPF's default 3-item jump.
    /// </summary>
    private void SlowScroll_PreviewMouseWheel(object sender, MouseWheelEventArgs e)
    {
        if (e.Delta == 0) return;
        if (FindVisualChild<ScrollViewer>((DependencyObject)sender) is not { } viewer) return;
        var offset = viewer.VerticalOffset - e.Delta / 3.0;
        viewer.ScrollToVerticalOffset(Math.Max(0, offset));
        e.Handled = true;
    }

    private static T? FindVisualChild<T>(DependencyObject parent) where T : DependencyObject
    {
        for (var i = 0; i < VisualTreeHelper.GetChildrenCount(parent); i++)
        {
            var child = VisualTreeHelper.GetChild(parent, i);
            if (child is T typed) return typed;
            if (FindVisualChild<T>(child) is { } nested) return nested;
        }
        return null;
    }

    private static T? FindVisualParent<T>(DependencyObject child) where T : DependencyObject
    {
        var current = child;
        while (current is not null)
        {
            if (current is T typed) return typed;
            current = current is FrameworkContentElement content
                ? content.Parent
                : VisualTreeHelper.GetParent(current);
        }
        return null;
    }

    /// <summary>Double-clicking a browse result opens its detail drawer, unless
    /// the double-click landed on one of the card's buttons (install/details).</summary>
    private void BrowseList_MouseDoubleClick(object sender, MouseButtonEventArgs e)
    {
        if (e.OriginalSource is not DependencyObject source) return;
        if (FindVisualParent<Button>(source) is not null) return;
        if (sender is ListBox { DataContext: ModsViewModel vm } listBox && listBox.SelectedItem is ModSearcher.SearchRow row)
            vm.SelectModCommand.Execute(row);
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

    private void CategoryChip_Click(object sender, RoutedEventArgs e)
    {
        if (sender is RadioButton { DataContext: ModsViewModel.CategoryOption option } &&
            DataContext is ModsViewModel vm)
        {
            vm.SelectedCategory = option;
        }
    }
}
