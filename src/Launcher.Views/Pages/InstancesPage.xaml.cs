using System.Windows.Controls;
using System.Windows.Input;
using Launcher.ViewModels;

namespace Launcher.Views.Pages;

public partial class InstancesPage : UserControl
{
    public InstancesPage()
    {
        InitializeComponent();
        DataContext = AppHost.Services!.Container.Resolve<InstancesViewModel>();
    }

    private void OnInstanceDoubleClick(object sender, MouseButtonEventArgs e)
    {
        if (sender is ListBox { SelectedItem: not null } listBox &&
            listBox.DataContext is InstancesViewModel vm &&
            vm.Selected is not null)
        {
            vm.PlayCommand.Execute(null);
        }
    }
}
