using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using Launcher.ViewModels;

namespace Launcher.Views.Controls;

/// <summary>
/// Full-window global search overlay. Owns keyboard handling (arrows, Enter, Esc)
/// and syncs visibility with <see cref="SearchViewModel.IsOpen"/>.
/// </summary>
public partial class SearchOverlay : UserControl
{
    private SearchViewModel? _vm;

    public SearchOverlay()
    {
        InitializeComponent();
        DataContextChanged += (_, _) => _vm = DataContext as SearchViewModel;
        IsVisibleChanged += OnVisibleChanged;
    }

    private void OnVisibleChanged(object? sender, DependencyPropertyChangedEventArgs e)
    {
        if (IsVisible)
        {
            Dispatcher.BeginInvoke(() =>
            {
                SearchBox.Focus();
                SearchBox.SelectAll();
            }, System.Windows.Threading.DispatcherPriority.Input);
        }
    }

    private void OnPreviewKeyDown(object sender, KeyEventArgs e)
    {
        switch (e.Key)
        {
            case Key.Escape:
                _vm?.Close();
                e.Handled = true;
                break;
            case Key.Enter:
                _vm?.ActivateSelection();
                e.Handled = true;
                break;
            case Key.Down:
                _vm?.MoveSelection(1);
                e.Handled = true;
                break;
            case Key.Up:
                _vm?.MoveSelection(-1);
                e.Handled = true;
                break;
        }
    }

    private void OnBackdropClick(object sender, MouseButtonEventArgs e)
    {
        if (e.OriginalSource == Root) _vm?.Close();
    }

    private void OnPanelClicked(object sender, MouseButtonEventArgs e) => e.Handled = true;

    private void OnResultDoubleClick(object sender, MouseButtonEventArgs e)
    {
        if (e.ChangedButton == MouseButton.Left) _vm?.ActivateSelection();
    }
}