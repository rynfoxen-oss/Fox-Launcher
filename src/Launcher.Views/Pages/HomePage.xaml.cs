using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using Launcher.Models;
using Launcher.ViewModels;

namespace Launcher.Views.Pages;

public partial class HomePage : UserControl
{
    public HomePage()
    {
        InitializeComponent();
        DataContext = AppHost.Services!.Container.Resolve<HomeViewModel>();
        Loaded += OnLoaded;
    }

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        Loaded -= OnLoaded;
        await ((HomeViewModel)DataContext).InitializeAsync();
    }

    private void OnInstanceCardClick(object sender, MouseButtonEventArgs e)
    {
        if (sender is not Border { Tag: GameInstance instance }) return;
        var main = AppHost.Services!.Container.Resolve<MainViewModel>();
        main.SelectedInstance = instance;
    }
}
