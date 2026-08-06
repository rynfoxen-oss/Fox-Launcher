using System.Windows.Controls;
using Launcher.ViewModels;

namespace Launcher.Views.Pages;

public partial class ShadersPage : UserControl
{
    public ShadersPage()
    {
        InitializeComponent();
        DataContext = AppHost.Services!.Container.Resolve<ShadersViewModel>();
        Loaded += (_, _) => ((ShadersViewModel)DataContext).Refresh();
    }
}
