import bpy, json, os
from mathutils import Vector

def value(v):
    if isinstance(v, (int, float, bool, str)): return v
    try: return list(v)
    except: return str(v)

def nodes(tree):
    result=[]
    if not tree: return result
    for n in tree.nodes:
        d={'name': n.name, 'type': n.bl_idname, 'label': n.label,
           'inputs': {i.name: value(i.default_value) for i in n.inputs if hasattr(i,'default_value')},
           'links': [{'input': l.to_socket.name, 'from': l.from_node.name, 'output': l.from_socket.name} for l in tree.links if l.to_node==n]}
        if hasattr(n,'color_ramp'):
            d['ramp']=[{'position':e.position,'color':list(e.color)} for e in n.color_ramp.elements]
            d['interpolation']=n.color_ramp.interpolation
        if hasattr(n,'blend_type'): d['blend_type']=n.blend_type
        if n.bl_idname=='CompositorNodeRGB': d['color']=list(n.outputs[0].default_value)
        if hasattr(n,'image') and n.image: d['image']={'name':n.image.name, 'path':n.image.filepath, 'size':list(n.image.size)}
        result.append(d)
    return result

s=bpy.context.scene
objects=[]
for o in s.objects:
    d={'name':o.name,'type':o.type,'position':list(o.location),'quaternion':list(o.matrix_world.to_quaternion()),'dimensions':list(o.dimensions)}
    if o.type=='LIGHT': d.update({'power':o.data.energy,'color':list(o.data.color),'size':o.data.size,'shape':o.data.shape})
    if o.type=='CAMERA': d.update({'lens':o.data.lens,'sensor_width':o.data.sensor_width,'sensor_height':o.data.sensor_height,'sensor_fit':o.data.sensor_fit,'angle_x':o.data.angle_x,'angle_y':o.data.angle_y,'direction':list(o.matrix_world.to_quaternion() @ Vector((0,0,-1)))})
    if o.type=='MESH':
        pts=[o.matrix_world @ Vector(p) for p in o.bound_box]
        d.update({'bounds_min':[min(p[i] for p in pts) for i in range(3)],'bounds_max':[max(p[i] for p in pts) for i in range(3)],'materials':[m.name for m in o.data.materials]})
    objects.append(d)
report={'objects':objects,'world':nodes(s.world.node_tree),'materials':{m.name:nodes(m.node_tree) for m in bpy.data.materials if m.use_nodes},'compositor':nodes(s.node_tree),'view':{'transform':s.view_settings.view_transform,'look':s.view_settings.look,'exposure':s.view_settings.exposure,'gamma':s.view_settings.gamma},'render':{'engine':s.render.engine,'transparent':s.render.film_transparent,'width':s.render.resolution_x,'height':s.render.resolution_y}}
out=os.path.abspath('outputs/c03-blender-studio/blender-scene.json')
os.makedirs(os.path.dirname(out),exist_ok=True)
with open(out,'w',encoding='utf-8') as f: json.dump(report,f,ensure_ascii=False,indent=2)
print('C03_SCENE_REPORT='+out)
