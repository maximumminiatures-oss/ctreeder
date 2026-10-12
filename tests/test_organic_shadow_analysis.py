import importlib.util
from pathlib import Path
import pytest

pytest.importorskip('PIL', reason='Offline artwork analysis uses the game-tools Pillow environment.')
from PIL import Image, ImageDraw

SPEC = importlib.util.spec_from_file_location('organic_shadow_analysis', Path(__file__).resolve().parents[1]/'scripts'/'organic_shadow_analysis.py')
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


def mask():
    return Image.new('L',(54,54),0)


def test_only_completely_black_edges_block_as_full_edges():
    image=mask();draw=ImageDraw.Draw(image)
    draw.line((0,0,53,0),fill=255)
    draw.line((0,53,51,53),fill=255)
    edges,fractions=MODULE.light_edges(image)
    assert 'h:0:0' in edges
    assert 'h:0:1' not in edges
    assert fractions['h:0:1']==52/54


def test_concave_inset_paths_stay_in_black_and_omit_artificial_frame_closures():
    image=mask();draw=ImageDraw.Draw(image)
    draw.polygon([(0,0),(53,0),(53,8),(25,8),(25,35),(0,35)],fill=255)
    paths=MODULE.infer_contours(image,1,2)
    assert paths and all(MODULE.black_fraction(points,image)>=.995 for points in paths)
    assert all(points[0]!=points[-1] for points in paths)
    assert all(not(a[1]==b[1]==0) for points in paths for a,b in zip(points,points[1:]))
    assert sum(map(len,paths))<20


def test_isolated_black_shape_is_closed_and_tiny_interior_marks_are_ignored():
    image=mask();draw=ImageDraw.Draw(image)
    draw.ellipse((12,12,40,40),fill=255)
    draw.rectangle((3,3,4,4),fill=255)
    paths=MODULE.infer_contours(image,1,2)
    assert len(paths)==1 and paths[0][0]==paths[0][-1]
    assert 5<=len(paths[0])<=13
    assert MODULE.black_fraction(paths[0],image)>=.995


def test_small_filled_corner_is_not_lost_to_decorative_noise_filter():
    image=mask();ImageDraw.Draw(image).polygon([(0,0),(6,0),(0,6)],fill=255)
    paths=MODULE.infer_contours(image,1,2)
    assert paths and sum(map(len,paths))<=5


def test_solid_black_has_no_artificial_contour_but_all_four_edges_block():
    image=Image.new('L',(54,54),255)
    assert MODULE.infer_contours(image)==[]
    assert set(MODULE.light_edges(image)[0])=={'h:0:0','h:0:1','v:0:0','v:1:0'}


def test_accepted_inferred_contours_do_not_train_the_artist_style():
    image=mask();ImageDraw.Draw(image).rectangle((0,0,20,53),fill=255)
    rule={'w':1,'h':1,'paths':[{'points':[[.35,0],[.35,.5],[.35,1]]}]}
    examples={'artist':rule,'accepted-draft':{**rule,'source':'inferred','reviewed':True}}
    cache={name:(image,image,'digest') for name in examples}
    assert MODULE.calibrate(examples,cache)['trainingAssets']==1
