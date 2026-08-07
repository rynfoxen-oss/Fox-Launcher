using System.ComponentModel;
using System.Windows.Controls;
using Launcher.ViewModels;

namespace Launcher.Views.Pages;

public partial class LogsPage : UserControl
{
    public LogsPage()
    {
        InitializeComponent();
        var vm = AppHost.Services!.Container.Resolve<LogsViewModel>();
        DataContext = vm;
        vm.PropertyChanged += OnVmPropertyChanged;
    }

    private void OnVmPropertyChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (e.PropertyName != nameof(LogsViewModel.Lines)) return;
        if (Dispatcher.CheckAccess())
        {
            ScrollToBottom();
        }
        else
        {
            Dispatcher.BeginInvoke(ScrollToBottom);
        }
    }

    private void ScrollToBottom()
    {
        if (LogList.Items.Count > 0)
        {
            LogList.ScrollIntoView(LogList.Items[LogList.Items.Count - 1]);
        }
    }
}
