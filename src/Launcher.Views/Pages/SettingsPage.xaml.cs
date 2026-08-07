using System.Windows;
using System.Windows.Controls;
using Launcher.ViewModels;

namespace Launcher.Views.Pages;

public partial class SettingsPage : UserControl
{
    public SettingsPage()
    {
        InitializeComponent();
        DataContext = AppHost.Services!.Container.Resolve<SettingsViewModel>();
    }

    private void OnSectionChanged(object sender, SelectionChangedEventArgs e)
    {
        var index = SectionList.SelectedIndex;
        GameSection.Visibility = index == 0 ? Visibility.Visible : Visibility.Collapsed;
        PerformanceSection.Visibility = index == 1 ? Visibility.Visible : Visibility.Collapsed;
        AppearanceSection.Visibility = index == 2 ? Visibility.Visible : Visibility.Collapsed;
        GeneralSection.Visibility = index == 3 ? Visibility.Visible : Visibility.Collapsed;
        AboutSection.Visibility = index == 4 ? Visibility.Visible : Visibility.Collapsed;
    }
}
