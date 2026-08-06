using System.Windows.Controls;
using Launcher.ViewModels;

namespace Launcher.Views.Pages;

public partial class NewsPage : UserControl
{
    public NewsPage()
    {
        InitializeComponent();
        DataContext = AppHost.Services!.Container.Resolve<NewsViewModel>();
        Loaded += async (_, _) => await ((NewsViewModel)DataContext).LoadAsync();
    }
}
