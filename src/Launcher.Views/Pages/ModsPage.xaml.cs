using System.Linq;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
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
