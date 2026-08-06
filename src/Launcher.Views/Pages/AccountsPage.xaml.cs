using System.Windows.Controls;
using Launcher.ViewModels;

namespace Launcher.Views.Pages;

public partial class AccountsPage : UserControl
{
    public AccountsPage()
    {
        InitializeComponent();
        DataContext = AppHost.Services!.Container.Resolve<AccountsViewModel>();
    }
}
