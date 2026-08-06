using System.Windows;
using System.Windows.Input;

namespace Launcher.UI;

/// <summary>Simple modal text prompt used for renaming instances.</summary>
public partial class RenameDialog : Window
{
    public RenameDialog(string title, string initialValue)
    {
        InitializeComponent();
        PromptText.Text = title;
        ValueBox.Text = initialValue ?? "";
        ValueBox.SelectAll();
        Loaded += (_, _) => ValueBox.Focus();
    }

    public string Value => ValueBox.Text;

    private void OnOkClick(object sender, RoutedEventArgs e)
    {
        DialogResult = true;
    }

    private void OnValueKeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key == Key.Enter)
        {
            DialogResult = true;
        }
    }

    private void OnTitleMouseDown(object sender, MouseButtonEventArgs e)
    {
        if (e.ChangedButton == MouseButton.Left) DragMove();
    }
}
