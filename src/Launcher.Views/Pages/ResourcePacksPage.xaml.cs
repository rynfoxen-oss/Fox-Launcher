using System.Windows.Controls;
using Launcher.ViewModels;

namespace Launcher.Views.Pages;

public partial class ResourcePacksPage : UserControl
{
    public ResourcePacksPage()
    {
        InitializeComponent();
        DataContext = AppHost.Services!.Container.Resolve<ResourcePacksViewModel>();
        Loaded += (_, _) => ((ResourcePacksViewModel)DataContext).Refresh();
    }
}
