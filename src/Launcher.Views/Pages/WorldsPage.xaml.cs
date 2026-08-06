using System.Windows.Controls;
using Launcher.ViewModels;

namespace Launcher.Views.Pages;

public partial class WorldsPage : UserControl
{
    public WorldsPage()
    {
        InitializeComponent();
        DataContext = AppHost.Services!.Container.Resolve<WorldsViewModel>();
        Loaded += (_, _) => ((WorldsViewModel)DataContext).Refresh();
    }
}
