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
}
