using System.Windows;
using System.Windows.Media.Animation;

namespace Launcher.UI;

/// <summary>
/// Animates a <see cref="GridLength"/> value (used to smoothly collapse/expand
/// the sidebar column). WPF has no built-in animation for GridLength, so this
/// interpolates the pixel component between the origin and destination.
/// </summary>
public sealed class GridLengthAnimation : AnimationTimeline
{
    public override Type TargetPropertyType => typeof(GridLength);

    public GridLength? From { get; set; }

    public GridLength To { get; set; }

    public override object GetCurrentValue(object defaultOriginValue, object defaultDestinationValue, AnimationClock animationClock)
    {
        if (animationClock.CurrentProgress is not double progress)
        {
            return defaultDestinationValue;
        }

        double from = From?.Value ?? (defaultOriginValue is GridLength origin ? origin.Value : 0);
        double to = To.Value;

        // Quadratic ease-out so the sidebar glides to a stop instead of ending abruptly.
        double eased = 1 - (1 - progress) * (1 - progress);
        return new GridLength(from + (to - from) * eased);
    }

    protected override Freezable CreateInstanceCore() => new GridLengthAnimation();
}
