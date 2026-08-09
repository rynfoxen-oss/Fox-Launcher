using System.Numerics;

namespace Launcher.Skin;

/// <summary>Triangle mesh data for one box (positions, normals, UVs, indices).
/// Pure data with no rendering-framework types so it can be shared by any host.</summary>
public sealed class MeshData
{
    public List<Vector3> Positions { get; } = new();
    public List<Vector3> Normals { get; } = new();
    public List<Vector2> TextureCoordinates { get; } = new();
    public List<int> Indices { get; } = new();

    public int VertexCount => Positions.Count;
}

/// <summary>One articulated body part: its pivot point (model units) plus the base
/// and overlay meshes. The overlay is a slightly enlarged copy so the outer skin
/// layer sits just outside the base model.</summary>
public sealed class PartModel
{
    public required SkinPart Part { get; init; }

    /// <summary>Rotation pivot in model units (world origin at the feet).</summary>
    public required Vector3 Pivot { get; init; }

    public required MeshData Base { get; init; }
    public required MeshData Overlay { get; init; }
}

/// <summary>
/// Builds the Minecraft player model: head, body, arms and legs with the exact
/// cuboid proportions of the game (classic arms 4×12×4, slim arms 3×12×4) and
/// Minecraft's official skin UV mapping. Geometry is produced once per model type
/// and cached by the renderer.
/// </summary>
public sealed class MinecraftPlayerModel
{
    private const float OverlayExpand = 0.25f;

    private readonly SkinModelType _type;
    private readonly int _textureWidth;
    private readonly int _textureHeight;

    private MinecraftPlayerModel(SkinModelType type, int textureWidth, int textureHeight)
    {
        _type = type;
        _textureWidth = textureWidth;
        _textureHeight = textureHeight;
    }

    /// <summary>Builds a fresh model for the given type and texture size.</summary>
    public static IReadOnlyList<PartModel> Build(SkinModelType type, int textureWidth, int textureHeight)
        => new MinecraftPlayerModel(type, textureWidth, textureHeight).BuildParts();

    private IReadOnlyList<PartModel> BuildParts()
    {
        var parts = new List<PartModel>();
        foreach (var (part, box, pivot) in DefineBoxes())
        {
            parts.Add(new PartModel
            {
                Part = part,
                Pivot = pivot,
                Base = BuildBox(part, SkinLayer.Base, box.Min, box.Size),
                Overlay = BuildBox(part, SkinLayer.Overlay,
                    box.Min - new Vector3(OverlayExpand), box.Size + new Vector3(OverlayExpand * 2))
            });
        }
        return parts;
    }

    private IEnumerable<(SkinPart Part, (Vector3 Min, Vector3 Size) Box, Vector3 Pivot)> DefineBoxes()
    {
        var slim = _type == SkinModelType.Slim;

        // Arms pivot at the shoulder (x = -5/+5, y = 22). Classic arms are
        // 4 wide (x -7..-3), slim arms 3 wide (x -6.5..-3.5).
        float armHalf = slim ? 1.5f : 2f;
        yield return (SkinPart.Head, (new Vector3(-4, 24, -4), new Vector3(8, 8, 8)), new Vector3(0, 24, 0));
        yield return (SkinPart.Body, (new Vector3(-4, 12, -2), new Vector3(8, 12, 4)), new Vector3(0, 12, 0));
        yield return (SkinPart.RightArm, (new Vector3(-(5 + armHalf), 20, -2), new Vector3(armHalf * 2, 12, 4)), new Vector3(-5, 22, 0));
        yield return (SkinPart.LeftArm, (new Vector3(5 - armHalf, 20, -2), new Vector3(armHalf * 2, 12, 4)), new Vector3(5, 22, 0));
        yield return (SkinPart.RightLeg, (new Vector3(-4, 0, -2), new Vector3(4, 12, 4)), new Vector3(-2, 12, 0));
        yield return (SkinPart.LeftLeg, (new Vector3(0, 0, -2), new Vector3(4, 12, 4)), new Vector3(2, 12, 0));
    }

    private MeshData BuildBox(SkinPart part, SkinLayer layer, Vector3 min, Vector3 size)
    {
        var mesh = new MeshData();
        float x0 = min.X, y0 = min.Y, z0 = min.Z;
        float x1 = min.X + size.X, y1 = min.Y + size.Y, z1 = min.Z + size.Z;

        void Face((Vector3 P, Vector3 N)[] corners, float u0, float v0, float u1, float v1)
        {
            int start = mesh.VertexCount;
            foreach (var (p, n) in corners)
            {
                mesh.Positions.Add(p);
                mesh.Normals.Add(n);
            }
            mesh.TextureCoordinates.Add(new Vector2(u0, v0));
            mesh.TextureCoordinates.Add(new Vector2(u1, v0));
            mesh.TextureCoordinates.Add(new Vector2(u1, v1));
            mesh.TextureCoordinates.Add(new Vector2(u0, v1));
            mesh.Indices.Add(start);
            mesh.Indices.Add(start + 1);
            mesh.Indices.Add(start + 2);
            mesh.Indices.Add(start);
            mesh.Indices.Add(start + 2);
            mesh.Indices.Add(start + 3);
        }

        var uvW = (float)_textureWidth;
        var uvH = (float)_textureHeight;
        var regions = SkinUVMapper.GetRegion;
        bool slim = _type == SkinModelType.Slim;

        // Front (+Z).
        var r = regions(part, layer, SkinFace.Front, slim, _textureWidth);
        Face(
            new[] { (new Vector3(x0, y0, z1), new Vector3(0, 0, 1)), (new Vector3(x1, y0, z1), new Vector3(0, 0, 1)),
                    (new Vector3(x1, y1, z1), new Vector3(0, 0, 1)), (new Vector3(x0, y1, z1), new Vector3(0, 0, 1)) },
            r.U / uvW, r.V / uvH, (r.U + r.W) / uvW, (r.V + r.H) / uvH);

        // Back (-Z), mirrored in x so the texture is not flipped.
        r = regions(part, layer, SkinFace.Back, slim, _textureWidth);
        Face(
            new[] { (new Vector3(x1, y0, z0), new Vector3(0, 0, -1)), (new Vector3(x0, y0, z0), new Vector3(0, 0, -1)),
                    (new Vector3(x0, y1, z0), new Vector3(0, 0, -1)), (new Vector3(x1, y1, z0), new Vector3(0, 0, -1)) },
            r.U / uvW, r.V / uvH, (r.U + r.W) / uvW, (r.V + r.H) / uvH);

        // Right face (character's right, -X).
        r = regions(part, layer, SkinFace.Right, slim, _textureWidth);
        Face(
            new[] { (new Vector3(x0, y0, z0), new Vector3(-1, 0, 0)), (new Vector3(x0, y0, z1), new Vector3(-1, 0, 0)),
                    (new Vector3(x0, y1, z1), new Vector3(-1, 0, 0)), (new Vector3(x0, y1, z0), new Vector3(-1, 0, 0)) },
            r.U / uvW, r.V / uvH, (r.U + r.W) / uvW, (r.V + r.H) / uvH);

        // Left face (character's left, +X), mirrored.
        r = regions(part, layer, SkinFace.Left, slim, _textureWidth);
        Face(
            new[] { (new Vector3(x1, y0, z1), new Vector3(1, 0, 0)), (new Vector3(x1, y0, z0), new Vector3(1, 0, 0)),
                    (new Vector3(x1, y1, z0), new Vector3(1, 0, 0)), (new Vector3(x1, y1, z1), new Vector3(1, 0, 0)) },
            r.U / uvW, r.V / uvH, (r.U + r.W) / uvW, (r.V + r.H) / uvH);

        // Top (+Y): region v=top row is the back edge, v+h is the front edge.
        r = regions(part, layer, SkinFace.Top, slim, _textureWidth);
        Face(
            new[] { (new Vector3(x0, y1, z1), new Vector3(0, 1, 0)), (new Vector3(x1, y1, z1), new Vector3(0, 1, 0)),
                    (new Vector3(x1, y1, z0), new Vector3(0, 1, 0)), (new Vector3(x0, y1, z0), new Vector3(0, 1, 0)) },
            r.U / uvW, r.V / uvH, (r.U + r.W) / uvW, (r.V + r.H) / uvH);

        // Bottom (-Y), mirrored.
        r = regions(part, layer, SkinFace.Bottom, slim, _textureWidth);
        Face(
            new[] { (new Vector3(x0, y0, z0), new Vector3(0, -1, 0)), (new Vector3(x1, y0, z0), new Vector3(0, -1, 0)),
                    (new Vector3(x1, y0, z1), new Vector3(0, -1, 0)), (new Vector3(x0, y0, z1), new Vector3(0, -1, 0)) },
            (r.U + r.W) / uvW, r.V / uvH, r.U / uvW, (r.V + r.H) / uvH);

        return mesh;
    }
}
