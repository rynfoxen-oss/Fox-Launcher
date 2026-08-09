using System;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;

namespace Launcher.Views.Controls;

/// <summary>
/// A slider whose track, fill and knob are laid out entirely in code, so the
/// knob always renders at the exact value position with correct centering and
/// fill. The native WPF track arrangement is not used at all. Clicking anywhere
/// on the bar jumps the value there and keeps dragging; the built-in keyboard
/// stepping still works.
/// </summary>
public sealed class JumpSlider : Slider
{
    private const double ThumbWidth = 18.0;

    private FrameworkElement? _track;
    private FrameworkElement? _fill;
    private FrameworkElement? _thumb;

    static JumpSlider()
    {
        DefaultStyleKeyProperty.OverrideMetadata(typeof(JumpSlider),
            new FrameworkPropertyMetadata(typeof(JumpSlider)));
    }

    public override void OnApplyTemplate()
    {
        base.OnApplyTemplate();
        SizeChanged -= OnSizeChangedForLayout;
        SizeChanged += OnSizeChangedForLayout;

        _track = GetTemplateChild("PART_Track") as FrameworkElement;
        _fill = GetTemplateChild("PART_Fill") as FrameworkElement;
        _thumb = GetTemplateChild("PART_Thumb") as FrameworkElement;
        UpdatePositions();
    }

    private void OnSizeChangedForLayout(object sender, SizeChangedEventArgs e) => UpdatePositions();

    protected override void OnValueChanged(double oldValue, double newValue)
    {
        base.OnValueChanged(oldValue, newValue);
        UpdatePositions();
    }

    protected override void OnMinimumChanged(double oldMinimum, double newMinimum)
    {
        base.OnMinimumChanged(oldMinimum, newMinimum);
        UpdatePositions();
    }

    protected override void OnMaximumChanged(double oldMaximum, double newMaximum)
    {
        base.OnMaximumChanged(oldMaximum, newMaximum);
        UpdatePositions();
    }

    protected override void OnMouseLeftButtonDown(MouseButtonEventArgs e)
    {
        base.OnMouseLeftButtonDown(e);
        if (!IsEnabled || Orientation == Orientation.Vertical) return;

        Focus();
        CaptureMouse();
        SetValueFromPointer(e.GetPosition(this));
        e.Handled = true;
    }

    protected override void OnMouseMove(MouseEventArgs e)
    {
        if (IsMouseCaptured) SetValueFromPointer(e.GetPosition(this));
        base.OnMouseMove(e);
    }

    protected override void OnMouseLeftButtonUp(MouseButtonEventArgs e)
    {
        if (IsMouseCaptured) ReleaseMouseCapture();
        base.OnMouseLeftButtonUp(e);
    }

    /// <summary>Maps a pointer position (in this control's coordinates) to a value.</summary>
    private void SetValueFromPointer(Point position)
    {
        var bounds = GetTrackBounds();
        if (bounds.Width <= 0) return;

        var fraction = (position.X - bounds.Left) / bounds.Width;
        var value = Minimum + Math.Clamp(fraction, 0.0, 1.0) * (Maximum - Minimum);
        SetCurrentValue(ValueProperty, value); // Slider snaps to ticks when enabled
    }

    private void UpdatePositions()
    {
        if (_track is null || _fill is null || _thumb is null) return;

        var bounds = GetTrackBounds();
        if (bounds.Width <= 0 || bounds.Height <= 0) return;

        var usable = Math.Max(1.0, bounds.Width - ThumbWidth);
        var fraction = Maximum > Minimum ? (Value - Minimum) / (Maximum - Minimum) : 0.0;
        fraction = Math.Clamp(fraction, 0.0, 1.0);

        // Knob travels from the left to the right edge of the visible bar,
        // clamped so it can never leave the control (and thus never get
        // clipped by a parent).
        var thumbLeft = Math.Clamp(bounds.Left + fraction * usable,
            0.0, Math.Max(0.0, ActualWidth - ThumbWidth));

        // Vertically the knob is centered on the TRACK itself (not on the
        // control), so it stays aligned with the bar regardless of the
        // control's actual height, alignment or DPI scale.
        var thumbTop = bounds.Top + bounds.Height / 2.0 - ThumbWidth / 2.0;
        thumbTop = Math.Clamp(thumbTop,
            0.0, Math.Max(0.0, ActualHeight - ThumbWidth));

        Canvas.SetLeft(_thumb, thumbLeft);
        Canvas.SetTop(_thumb, thumbTop);

        // Fill runs from the bar's left edge to the knob's center.
        _fill.Width = fraction * usable + ThumbWidth / 2.0;
    }

    private Rect GetTrackBounds()
    {
        if (_track is null) return Rect.Empty;
        try
        {
            return _track.TransformToAncestor(this)
                .TransformBounds(new Rect(_track.RenderSize));
        }
        catch (InvalidOperationException)
        {
            // Not yet connected to a presentation source (early layout) —
            // SizeChanged will re-run the layout once the tree is live.
            return Rect.Empty;
        }
    }
}
