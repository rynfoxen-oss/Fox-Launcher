using System.Windows;
using System.Windows.Controls;

namespace Launcher.Views.Controls;

/// <summary>Page title + subtitle + optional actions area.</summary>
public partial class PageHeader : UserControl
{
    public PageHeader()
    {
        InitializeComponent();
    }

    public static readonly DependencyProperty TitleProperty =
        DependencyProperty.Register(nameof(Title), typeof(string), typeof(PageHeader),
            new PropertyMetadata("", OnTitleChanged));

    public string Title
    {
        get => (string)GetValue(TitleProperty);
        set => SetValue(TitleProperty, value);
    }

    public static readonly DependencyProperty SubtitleProperty =
        DependencyProperty.Register(nameof(Subtitle), typeof(string), typeof(PageHeader),
            new PropertyMetadata("", OnSubtitleChanged));

    public string Subtitle
    {
        get => (string)GetValue(SubtitleProperty);
        set => SetValue(SubtitleProperty, value);
    }

    public static readonly DependencyProperty ActionsContentProperty =
        DependencyProperty.Register(nameof(ActionsContent), typeof(object), typeof(PageHeader),
            new PropertyMetadata(null, OnActionsChanged));

    public object? ActionsContent
    {
        get => GetValue(ActionsContentProperty);
        set => SetValue(ActionsContentProperty, value);
    }

    private static void OnTitleChanged(DependencyObject d, DependencyPropertyChangedEventArgs e)
        => ((PageHeader)d).TitleText.Text = (string)e.NewValue;

    private static void OnSubtitleChanged(DependencyObject d, DependencyPropertyChangedEventArgs e)
        => ((PageHeader)d).SubtitleText.Text = (string)e.NewValue;

    private static void OnActionsChanged(DependencyObject d, DependencyPropertyChangedEventArgs e)
        => ((PageHeader)d).Actions.Content = e.NewValue;
}
