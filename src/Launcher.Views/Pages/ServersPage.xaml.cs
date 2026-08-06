using System.Windows.Controls;
using Launcher.ViewModels;

namespace Launcher.Views.Pages;

public partial class ServersPage : UserControl
{
    public ServersPage()
    {
        InitializeComponent();
        DataContext = AppHost.Services!.Container.Resolve<ServersViewModel>();
    }
}
