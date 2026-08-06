using System.Windows.Controls;
using Launcher.ViewModels;

namespace Launcher.Views.Pages;

public partial class ScreenshotsPage : UserControl
{
    public ScreenshotsPage()
    {
        InitializeComponent();
        DataContext = AppHost.Services!.Container.Resolve<ScreenshotsViewModel>();
        Loaded += (_, _) => ((ScreenshotsViewModel)DataContext).Refresh();
    }
}
