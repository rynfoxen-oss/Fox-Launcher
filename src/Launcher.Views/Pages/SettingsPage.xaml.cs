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
        var key = (SectionList.SelectedItem as SettingsSection)?.Key;
        LauncherSection.Visibility = key == "launcher" ? Visibility.Visible : Visibility.Collapsed;
        GameSection.Visibility = key == "game" ? Visibility.Visible : Visibility.Collapsed;
        PerformanceSection.Visibility = key == "performance" ? Visibility.Visible : Visibility.Collapsed;
        AppearanceSection.Visibility = key == "appearance" ? Visibility.Visible : Visibility.Collapsed;
        DownloadsSection.Visibility = key == "downloads" ? Visibility.Visible : Visibility.Collapsed;
        GeneralSection.Visibility = key == "general" ? Visibility.Visible : Visibility.Collapsed;
        AboutSection.Visibility = key == "about" ? Visibility.Visible : Visibility.Collapsed;
        MaintenanceSection.Visibility = key == "maintenance" ? Visibility.Visible : Visibility.Collapsed;
        ContentScroller?.ScrollToTop();
    }
}
