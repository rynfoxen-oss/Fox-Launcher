using System.Diagnostics;
using System.IO;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using System.Windows.Media.Media3D;
using Launcher.Skin;

namespace Launcher.Views.Controls;

/// <summary>
/// Interactive 3D Minecraft skin figure rendered with WPF's built-in
/// <see cref="Viewport3D"/>. Drag to orbit, scroll to zoom. The model uses the
/// exact proportions and official UV layout of the game, with classic and slim
/// arm variants. An idle animation and gentle auto-spin can be toggled.
/// </summary>
public partial class SkinViewer : UserControl
{
    public SkinViewer()
    {
        InitializeComponent();
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        SizeChanged += (_, _) => UpdateFraming();

        Viewport.MouseLeftButtonDown += (_, e) =>
        {
            // Double-click resets the camera framing.
            if (e.Timestamp - _lastClickTime < 500)
                ResetView();
            _lastClickTime = e.Timestamp;
            Viewport.CaptureMouse();
            _dragging = true;
            _lastDrag = e.GetPosition(Viewport);
        };
        Viewport.MouseMove += (_, e) =>
        {
            if (!_dragging) return;
            var p = e.GetPosition(Viewport);
            _yaw += (p.X - _lastDrag.X) * 0.008;
            _pitch = Math.Clamp(_pitch + (p.Y - _lastDrag.Y) * 0.008, -1.2, 0.8);
            _lastDrag = p;
            ApplyCamera();
        };
        Viewport.MouseLeftButtonUp += (_, _) =>
        {
            Viewport.ReleaseMouseCapture();
            _dragging = false;
        };
        Viewport.MouseWheel += (_, e) =>
        {
            _distance = Math.Clamp(_distance * (e.Delta > 0 ? 0.92 : 1.08), _minDistance, _maxDistance);
            ApplyCamera();
        };
    }

    private void ResetView()
    {
        _yaw = 0.785;
        _pitch = -0.12;
        _distance = _framingDistance;
        ApplyCamera();
    }

    /// <summary>Default skin (Steve) bundled as a project resource so the preview
    /// works even without an internet connection.</summary>
    private const string DefaultSkinResource = "pack://application:,,,/Launcher.Views;component/Assets/skins/default_steve.png";

    public static readonly DependencyProperty TextureUrlProperty =
        DependencyProperty.Register(nameof(TextureUrl), typeof(string), typeof(SkinViewer),
            new PropertyMetadata("", (d, _) => ((SkinViewer)d).Refresh()));

    public string TextureUrl
    {
        get => (string)GetValue(TextureUrlProperty);
        set => SetValue(TextureUrlProperty, value);
    }

    public static readonly DependencyProperty ShowBodyProperty =
        DependencyProperty.Register(nameof(ShowBody), typeof(bool), typeof(SkinViewer),
            new PropertyMetadata(true, (d, _) => ((SkinViewer)d).RenderChanged()));

    public bool ShowBody
    {
        get => (bool)GetValue(ShowBodyProperty);
        set => SetValue(ShowBodyProperty, value);
    }

    /// <summary>Approximate pixel width of the head. Kept for API compatibility;
    /// the 3D view scales to the available space instead.</summary>
    public static readonly DependencyProperty HeadWidthProperty =
        DependencyProperty.Register(nameof(HeadWidth), typeof(double), typeof(SkinViewer),
            new PropertyMetadata(96.0));

    public double HeadWidth
    {
        get => (double)GetValue(HeadWidthProperty);
        set => SetValue(HeadWidthProperty, value);
    }

    /// <summary>"Auto", "Classic" or "Slim" (Auto uses the account variant, then
    /// falls back to pixel detection).</summary>
    public static readonly DependencyProperty ModelPreferenceProperty =
        DependencyProperty.Register(nameof(ModelPreference), typeof(string), typeof(SkinViewer),
            new PropertyMetadata("Auto", (d, _) => ((SkinViewer)d).RenderChanged()));

    public string ModelPreference
    {
        get => (string)GetValue(ModelPreferenceProperty);
        set => SetValue(ModelPreferenceProperty, value);
    }

    /// <summary>Variant declared by the account: "CLASSIC", "SLIM" or empty.</summary>
    public static readonly DependencyProperty SkinVariantProperty =
        DependencyProperty.Register(nameof(SkinVariant), typeof(string), typeof(SkinViewer),
            new PropertyMetadata("", (d, _) => ((SkinViewer)d).RenderChanged()));

    public string SkinVariant
    {
        get => (string)GetValue(SkinVariantProperty);
        set => SetValue(SkinVariantProperty, value);
    }

    /// <summary>Whether the idle animation runs.</summary>
    public static readonly DependencyProperty AnimationEnabledProperty =
        DependencyProperty.Register(nameof(AnimationEnabled), typeof(bool), typeof(SkinViewer),
            new PropertyMetadata(true, (d, _) => ((SkinViewer)d).AnimationChanged()));

    public bool AnimationEnabled
    {
        get => (bool)GetValue(AnimationEnabledProperty);
        set => SetValue(AnimationEnabledProperty, value);
    }

    /// <summary>Whether the figure slowly auto-spins.</summary>
    public static readonly DependencyProperty AutoRotateProperty =
        DependencyProperty.Register(nameof(AutoRotate), typeof(bool), typeof(SkinViewer),
            new PropertyMetadata(false, (d, _) => ((SkinViewer)d).AnimationChanged()));

    public bool AutoRotate
    {
        get => (bool)GetValue(AutoRotateProperty);
        set => SetValue(AutoRotateProperty, value);
    }

    /// <summary>"Low", "Medium" or "High". Low disables antialiased edges.</summary>
    public static readonly DependencyProperty RenderQualityProperty =
        DependencyProperty.Register(nameof(RenderQuality), typeof(string), typeof(SkinViewer),
            new PropertyMetadata("Medium", (d, _) => ((SkinViewer)d).RenderChanged()));

    public string RenderQuality
    {
        get => (string)GetValue(RenderQualityProperty);
        set => SetValue(RenderQualityProperty, value);
    }

    private CancellationTokenSource? _loadCts;
    private SkinCache? _cache;

    // Built once per texture and reused every frame.
    private sealed class PartRig
    {
        public required Model3DGroup Group { get; init; }
        public required SkinPart Part { get; init; }
        public required Vector3D Pivot { get; init; }
        public required AxisAngleRotation3D Yaw { get; init; }
        public required AxisAngleRotation3D Pitch { get; init; }
    }

    private Model3DGroup? _rootGroup;
    private readonly List<PartRig> _rig = new();
    private readonly AxisAngleRotation3D _rootYaw = new(new Vector3D(0, 1, 0), 0);
    private readonly TranslateTransform3D _rootBob = new();
    private readonly Transform3DGroup _rootTransform = new();

    private Stopwatch? _clock;
    private bool _animating;
    private bool _dragging;
    private bool _framedOnce;
    private int _lastClickTime;

    private double _yaw = 0.785;
    private double _pitch = -0.12;
    private double _distance;
    private double _framingDistance;
    private double _minDistance;
    private double _maxDistance;
    private Point _lastDrag;

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        _clock = Stopwatch.StartNew();
        AnimationChanged();
        Refresh();
    }

    private void OnUnloaded(object sender, RoutedEventArgs e)
    {
        StopAnimation();
        _loadCts?.Cancel();
    }

    private void AnimationChanged()
    {
        if (AnimationEnabled || AutoRotate) StartAnimation();
        else StopAnimation();
    }

    private void StartAnimation()
    {
        if (_animating || !IsLoaded) return;
        _animating = true;
        _clock ??= Stopwatch.StartNew();
        CompositionTarget.Rendering += OnRendering;
    }

    private void StopAnimation()
    {
        if (!_animating) return;
        _animating = false;
        CompositionTarget.Rendering -= OnRendering;
    }

    private void OnRendering(object? sender, EventArgs e)
    {
        double t = _clock?.Elapsed.TotalSeconds ?? 0;
        UpdatePose(t);
    }

    private void UpdatePose(double t)
    {
        bool anim = AnimationEnabled;

        _rootYaw.Angle = AutoRotate ? (t * 18.0) % 360 : 0;
        _rootBob.OffsetY = anim ? Math.Sin(t * 2.4) * 0.55 : 0;

        double headYaw = anim ? Math.Sin(t * 0.9) * 8 : 0;
        double headPitch = anim ? Math.Sin(t * 0.6) * 2.5 : 0;
        double armSwing = anim ? Math.Sin(t * 1.9) * 3.5 : 0;

        foreach (var rig in _rig)
        {
            switch (rig.Part)
            {
                case SkinPart.Head:
                    rig.Yaw.Angle = headYaw;
                    rig.Pitch.Angle = headPitch;
                    break;
                case SkinPart.RightArm:
                    rig.Yaw.Angle = armSwing;
                    rig.Pitch.Angle = 0;
                    break;
                case SkinPart.LeftArm:
                    rig.Yaw.Angle = -armSwing;
                    rig.Pitch.Angle = 0;
                    break;
                default:
                    rig.Yaw.Angle = 0;
                    rig.Pitch.Angle = 0;
                    break;
            }
        }
    }

    private void RenderChanged()
    {
        if (!IsLoaded) return;
        ApplyQuality();
        UpdateFraming();
        Refresh();
    }

    private async void Refresh()
    {
        if (!IsLoaded) return;
        Busy.Visibility = Visibility.Visible;

        _loadCts?.Cancel();
        var cts = new CancellationTokenSource();
        _loadCts = cts;

        var requested = TextureUrl;
        var url = string.IsNullOrWhiteSpace(requested) ? DefaultSkinResource : requested;

        var bytes = await LoadBytesAsync(url, cts.Token).ConfigureAwait(true);
        if (cts.IsCancellationRequested || bytes is null) return;
        var decoded = Decode(bytes);

        bool isDefault = string.Equals(url, DefaultSkinResource, StringComparison.Ordinal);
        if (decoded is null && !isDefault)
        {
            var fallback = await LoadBytesAsync(DefaultSkinResource, cts.Token).ConfigureAwait(true);
            if (cts.IsCancellationRequested) return;
            bytes = fallback;
            decoded = fallback is null ? null : Decode(fallback);
            isDefault = true;
        }
        if (cts.IsCancellationRequested || decoded is null) return;
        // A newer refresh started while loading (e.g. account switch) - drop stale data.
        if (!string.Equals(TextureUrl, requested, StringComparison.Ordinal)) return;

        var (tex, image) = decoded.Value;

        SkinModelType type = ResolveType(tex);
        if (isDefault && type == SkinModelType.Slim)
        {
            // The bundled default is a classic Steve texture; crop it to a slim
            // layout so "Slim / Auto on a slim account" shows a proper Alex body.
            tex = tex.ToSlim();
            image = ToImage(tex);
        }

        BuildFigure(tex, type, image);
        Busy.Visibility = Visibility.Collapsed;
    }

    private SkinModelType ResolveType(SkinTexture tex)
    {
        switch (ModelPreference.Trim().ToLowerInvariant())
        {
            case "classic": return SkinModelType.Classic;
            case "slim": return SkinModelType.Slim;
        }
        if (SkinVariant.Equals("SLIM", StringComparison.OrdinalIgnoreCase)) return SkinModelType.Slim;
        if (SkinVariant.Equals("CLASSIC", StringComparison.OrdinalIgnoreCase)) return SkinModelType.Classic;
        return ModelDetector.Detect(tex) ?? SkinModelType.Classic;
    }

    private void BuildFigure(SkinTexture tex, SkinModelType type, ImageSource image)
    {
        IReadOnlyList<PartModel> parts = MinecraftPlayerModel.Build(type, tex.Width, tex.Height);

        var brush = new ImageBrush(image)
        {
            Stretch = Stretch.Fill,
            ViewboxUnits = BrushMappingMode.Absolute,
            ViewportUnits = BrushMappingMode.Absolute,
            Viewbox = new Rect(0, 0, ((BitmapSource) image).PixelWidth, ((BitmapSource) image).PixelHeight),
            Viewport = new Rect(0, 0, 1, 1)
        };
        RenderOptions.SetBitmapScalingMode(brush, BitmapScalingMode.NearestNeighbor);
        brush.Freeze();

        var material = new DiffuseMaterial(brush);
        material.Freeze();
        var back = new DiffuseMaterial(brush) { Color = Color.FromRgb(120, 120, 120) };
        back.Freeze();

        _rig.Clear();
        _rootGroup = new Model3DGroup { Transform = _rootTransform };
        _rootTransform.Children.Clear();
        _rootTransform.Children.Add(new TranslateTransform3D(0, -16, 0));
        _rootTransform.Children.Add(new RotateTransform3D(_rootYaw));
        _rootTransform.Children.Add(new TranslateTransform3D(0, 16, 0));
        _rootTransform.Children.Add(_rootBob);

        foreach (var part in parts)
        {
            if (!ShowBody && part.Part != SkinPart.Head) continue;

            var yaw = new AxisAngleRotation3D(new Vector3D(0, 1, 0), 0);
            var pitch = new AxisAngleRotation3D(new Vector3D(1, 0, 0), 0);
            var pivot = new Vector3D(part.Pivot.X, part.Pivot.Y, part.Pivot.Z);

            var transform = new Transform3DGroup();
            transform.Children.Add(new TranslateTransform3D(-pivot));
            transform.Children.Add(new RotateTransform3D(yaw));
            transform.Children.Add(new RotateTransform3D(pitch));
            transform.Children.Add(new TranslateTransform3D(pivot));

            var group = new Model3DGroup { Transform = transform };
            group.Children.Add(ToWpf(part.Base, material, back));
            group.Children.Add(ToWpf(part.Overlay, material, back));
            _rootGroup.Children.Add(group);

            _rig.Add(new PartRig { Group = group, Part = part.Part, Pivot = pivot, Yaw = yaw, Pitch = pitch });
        }

        FigureRoot.Content = _rootGroup;
        UpdateFraming();
        ApplyQuality();
    }

    private static GeometryModel3D ToWpf(MeshData mesh, Material material, Material back)
    {
        var geometry = new MeshGeometry3D
        {
            Positions = new Point3DCollection(mesh.Positions.Select(p => new Point3D(p.X, p.Y, p.Z))),
            Normals = new Vector3DCollection(mesh.Normals.Select(n => new Vector3D(n.X, n.Y, n.Z))),
            TextureCoordinates = new PointCollection(mesh.TextureCoordinates.Select(t => new Point(t.X, t.Y))),
            TriangleIndices = new Int32Collection(mesh.Indices)
        };
        geometry.Freeze();

        var model = new GeometryModel3D { Geometry = geometry, Material = material, BackMaterial = back };
        model.Freeze();
        return model;
    }

    private void UpdateFraming()
    {
        if (!IsLoaded) return;
        ApplyQuality();

        bool body = ShowBody;
        // Distance chosen so the full 32-unit figure (or 8-unit head) fits the
        // viewport vertically at the framing FOV, with comfortable margins.
        double dist = body ? 60.0 : 20.0;
        _minDistance = body ? 12.0 : 8.0;
        _maxDistance = body ? 90.0 : 40.0;

        if (!_framedOnce)
        {
            _framedOnce = true;
            _distance = dist;
        }
        _framingDistance = dist;
        ApplyCamera();
    }

    private void ApplyCamera()
    {
        var target = new Point3D(0, ShowBody ? 16.0 : 28.0, 0);
        double cy = Math.Cos(_pitch);
        var pos = new Point3D(
            target.X + _distance * Math.Sin(_yaw) * cy,
            target.Y + _distance * Math.Sin(_pitch),
            target.Z + _distance * Math.Cos(_yaw) * cy);

        Camera.Position = pos;
        Camera.LookDirection = new Vector3D(target.X - pos.X, target.Y - pos.Y, target.Z - pos.Z);
        Camera.UpDirection = new Vector3D(0, 1, 0);
        Camera.FieldOfView = ShowBody ? 36 : 40;
    }

    private void ApplyQuality()
    {
        bool low = RenderQuality.Trim().Equals("Low", StringComparison.OrdinalIgnoreCase);
        RenderOptions.SetEdgeMode(Viewport, low ? EdgeMode.Aliased : EdgeMode.Unspecified);
    }

    // ------------------------------------------------------------------ loading

    private async Task<byte[]?> LoadBytesAsync(string url, CancellationToken ct)
    {
        if (Uri.TryCreate(url, UriKind.Absolute, out var uri))
        {
            if (uri.Scheme == "file")
            {
                return File.Exists(uri.LocalPath) ? await File.ReadAllBytesAsync(uri.LocalPath, ct).ConfigureAwait(false) : null;
            }
            if (uri.Scheme == "pack")
            {
                try
                {
                    using var stream = Application.GetResourceStream(uri)?.Stream;
                    if (stream is null) return null;
                    using var ms = new MemoryStream();
                    await stream.CopyToAsync(ms, ct).ConfigureAwait(false);
                    return ms.ToArray();
                }
                catch
                {
                    return null;
                }
            }
        }
        if (File.Exists(url))
        {
            return await File.ReadAllBytesAsync(url, ct).ConfigureAwait(false);
        }

        try
        {
            if (_cache is null && AppHost.Services?.Container is { } container)
            {
                var http = container.Resolve<Launcher.Network.Http>();
                _cache = http is null ? null : new SkinCache(http);
            }
            return _cache is null ? null : await _cache.GetAsync(url, ct).ConfigureAwait(false);
        }
        catch
        {
            return null;
        }
    }

    /// <summary>Decodes PNG bytes into BGRA pixels plus a frozen image for the material.</summary>
    private static (SkinTexture Texture, BitmapSource Image)? Decode(byte[] bytes)
    {
        try
        {
            using var ms = new MemoryStream(bytes);
            var src = new BitmapImage();
            src.BeginInit();
            src.CacheOption = BitmapCacheOption.OnLoad;
            src.StreamSource = ms;
            src.EndInit();

            BitmapSource tex = src.Format != PixelFormats.Pbgra32
                ? new FormatConvertedBitmap(src, PixelFormats.Pbgra32, null, 0)
                : src;
            if (tex.PixelWidth <= 0 || tex.PixelHeight <= 0) return null;

            var buf = new byte[tex.PixelWidth * tex.PixelHeight * 4];
            tex.CopyPixels(buf, tex.PixelWidth * 4, 0);
            tex.Freeze();
            return (new SkinTexture(tex.PixelWidth, tex.PixelHeight, buf), tex);
        }
        catch
        {
            return null;
        }
    }

    /// <summary>Builds a frozen bitmap source from raw BGRA pixels.</summary>
    private static BitmapSource ToImage(SkinTexture tex)
    {
        var wb = new WriteableBitmap(tex.Width, tex.Height, 96, 96, PixelFormats.Pbgra32, null);
        wb.WritePixels(new Int32Rect(0, 0, tex.Width, tex.Height), tex.Pixels, tex.Width * 4, 0);
        wb.Freeze();
        return wb;
    }
}
